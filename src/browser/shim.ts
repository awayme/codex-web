import {
  mapBrowserPathToInitialRoute,
  mapMemoryPathToBrowserPath,
} from "./routes";
import {
  handleLocalFilePickerMessage,
  isLocalFilePickerMessage,
} from "./files";
import {
  openSelectWorkspaceRootDialog,
  type WorkspaceDirectoryEntries,
} from "./workspace-root-dialog";

type IpcListener = (event: unknown, ...args: unknown[]) => void;

type RendererToMainMessage =
  | {
      type: "ipc-renderer-invoke";
      requestId: string;
      channel: string;
      args: unknown[];
    }
  | {
      type: "ipc-renderer-post-message";
      channel: string;
      message: unknown;
      portIds: string[];
    }
  | {
      type: "message-port-message";
      portId: string;
      data: unknown;
    }
  | {
      type: "message-port-close";
      portId: string;
    }
  | {
      type: "ipc-renderer-send";
      channel: string;
      args: unknown[];
    }
  | {
      type: "workspace-directory-entries-request";
      requestId: string;
      directoryPath: string | null;
      directoriesOnly: boolean;
    }
  | {
      type: "oauth-callback-forward";
      requestId: string;
      callback: unknown;
    };

type MainToRendererMessage =
  | {
      type: "ipc-main-event";
      channel: string;
      args: unknown[];
    }
  | {
      type: "open-external";
      url: string;
    }
  | {
      type: "ipc-renderer-invoke-result";
      requestId: string;
      ok: true;
      result: unknown;
    }
  | {
      type: "ipc-renderer-invoke-result";
      requestId: string;
      ok: false;
      errorMessage: string;
    }
  | {
      type: "workspace-directory-entries-result";
      requestId: string;
      ok: true;
      result: WorkspaceDirectoryEntries;
    }
  | {
      type: "workspace-directory-entries-result";
      requestId: string;
      ok: false;
      errorMessage: string;
    }
  | {
      type: "message-port-message";
      portId: string;
      data: unknown;
    }
  | {
      type: "message-port-close";
      portId: string;
    }
  | {
      type: "oauth-callback-forward-result";
      requestId: string;
      ok: true;
    }
  | {
      type: "oauth-callback-forward-result";
      requestId: string;
      ok: false;
      errorMessage: string;
    };

const RECONNECT_DELAY_MS = 1_000;
const RENDERER_TAKEOVER_CLOSE_CODE = 4001;

type MemoryNavigationChange = {
  action: "POP" | "PUSH" | "REPLACE";
  delta: number;
  location: {
    hash: string;
    key: string;
    pathname: string;
    search: string;
    state: unknown;
  };
};

type StatsigGateEvaluation = {
  name: string;
  value: boolean;
  [key: string]: unknown;
};

type ElectronShimState = {
  initialRoute?: string;
  initialSidebarState?: boolean;
  closeSidebar?: () => void;
  onMemoryNavigationChanged?: (navigation: MemoryNavigationChange) => void;
  overrideAdapter?: {
    getGateOverride?: (
      evaluation: StatsigGateEvaluation,
      ...args: unknown[]
    ) => StatsigGateEvaluation | null;
  };
};

declare global {
  interface Window {
    __ELECTRON_SHIM__?: ElectronShimState;
  }
}

declare const __CODEX_APP_VERSION__: string;

let requestCounter = 0;
let socket: WebSocket | null = null;
let reconnectTimeoutId: number | null = null;
const outboundQueue: RendererToMainMessage[] = [];
const pendingInvokes = new Map<
  string,
  {
    reject: (reason?: unknown) => void;
    resolve: (value: unknown) => void;
  }
>();
const pendingDirectoryEntries = new Map<
  string,
  {
    reject: (reason?: unknown) => void;
    resolve: (value: WorkspaceDirectoryEntries) => void;
  }
>();
const rendererListeners = new Map<string, Set<IpcListener>>();
const messagePorts = new Map<string, MessagePort>();
const oauthCallbackRequestIds = new Set<string>();
const oauthCallbackChannel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("codex-web-oauth-callback");

if (oauthCallbackChannel) {
  oauthCallbackChannel.addEventListener("message", (event) => {
    const value = event.data as unknown;
    if (
      !isRecord(value) ||
      value.type !== "codex-web-oauth-callback" ||
      typeof value.requestId !== "string" ||
      oauthCallbackRequestIds.has(value.requestId)
    ) {
      return;
    }

    oauthCallbackRequestIds.add(value.requestId);
    window.setTimeout(() => {
      oauthCallbackRequestIds.delete(value.requestId);
    }, 2_000);
    enqueueMessage({
      type: "oauth-callback-forward",
      requestId: value.requestId,
      callback: value.callback,
    });
  });
}

function unimplemented(method: string): never {
  debugger;
  throw new Error(`[electron-stub] ${method} is not implemented`);
}

let externalLinkPrompt: HTMLElement | null = null;
let manualOAuthCallbackPrompt: {
  dismiss: () => void;
  input: HTMLTextAreaElement;
  requestId: string | null;
  status: HTMLElement;
  submit: HTMLButtonElement;
} | null = null;

function isRemoteControlAuthorizationUrl(url: URL): boolean {
  if (
    url.protocol !== "https:" ||
    url.hostname !== "auth.openai.com" ||
    url.pathname !== "/oauth/authorize"
  ) {
    return false;
  }

  const scopes = url.searchParams.get("scope")?.split(/\s+/) ?? [];
  if (!scopes.includes("codex.remote_control.enroll")) {
    return false;
  }

  const redirectValue = url.searchParams.get("redirect_uri");
  if (!redirectValue) {
    return false;
  }

  try {
    const redirectUrl = new URL(redirectValue);
    return (
      redirectUrl.protocol === "http:" &&
      redirectUrl.hostname === "localhost" &&
      new Set(["1455", "1457"]).has(redirectUrl.port) &&
      redirectUrl.pathname === "/auth/callback"
    );
  } catch {
    return false;
  }
}

function parseManualOAuthCallbackUrl(value: string): string {
  const trimmed = value.trim();
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(trimmed);
  } catch {
    throw new Error("Paste the complete localhost callback URL.");
  }

  if (
    callbackUrl.protocol !== "http:" ||
    callbackUrl.hostname !== "localhost" ||
    !new Set(["1455", "1457"]).has(callbackUrl.port) ||
    callbackUrl.pathname !== "/auth/callback" ||
    callbackUrl.username !== "" ||
    callbackUrl.password !== "" ||
    callbackUrl.hash !== "" ||
    !callbackUrl.searchParams.has("state") ||
    (!callbackUrl.searchParams.has("code") &&
      !callbackUrl.searchParams.has("error"))
  ) {
    throw new Error(
      "Use the complete http://localhost:1455 or :1457 callback URL from OpenAI.",
    );
  }

  return callbackUrl.toString();
}

function getActiveModalMountTarget(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLElement>(
    '[role="dialog"][aria-modal="true"]',
  );
  for (let index = dialogs.length - 1; index >= 0; index -= 1) {
    const dialog = dialogs[index];
    if (dialog?.isConnected) {
      return dialog;
    }
  }
  return document.body;
}

function showManualOAuthCallbackPrompt(): void {
  manualOAuthCallbackPrompt?.dismiss();

  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute(
    "aria-labelledby",
    "codex-web-manual-oauth-callback-title",
  );
  Object.assign(overlay.style, {
    alignItems: "center",
    background: "rgb(0 0 0 / 45%)",
    display: "flex",
    inset: "0",
    justifyContent: "center",
    padding: "24px",
    pointerEvents: "auto",
    position: "fixed",
    zIndex: "2147483647",
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    background: "Canvas",
    border: "1px solid color-mix(in srgb, CanvasText 20%, transparent)",
    borderRadius: "12px",
    boxShadow: "0 18px 55px rgb(0 0 0 / 25%)",
    color: "CanvasText",
    font: "14px system-ui, sans-serif",
    maxWidth: "560px",
    padding: "24px",
    width: "100%",
  });

  const title = document.createElement("h2");
  title.id = "codex-web-manual-oauth-callback-title";
  title.textContent = "Complete remote-control authorization";
  Object.assign(title.style, {
    fontSize: "18px",
    margin: "0 0 8px",
  });

  const detail = document.createElement("p");
  detail.textContent =
    "After OpenAI redirects to a localhost page, copy the complete URL from that tab's address bar, return here, and paste it below. Do not paste the URL into chat.";
  Object.assign(detail.style, {
    lineHeight: "1.5",
    margin: "0 0 14px",
    opacity: "0.78",
  });

  const form = document.createElement("form");

  const label = document.createElement("label");
  label.htmlFor = "codex-web-manual-oauth-callback-url";
  label.textContent = "OpenAI localhost callback URL";
  Object.assign(label.style, {
    display: "block",
    fontWeight: "600",
    marginBottom: "7px",
  });

  const input = document.createElement("textarea");
  input.id = "codex-web-manual-oauth-callback-url";
  input.name = "callbackUrl";
  input.rows = 4;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "http://localhost:1455/auth/callback?code=…&state=…";
  Object.assign(input.style, {
    background: "Canvas",
    border: "1px solid color-mix(in srgb, CanvasText 25%, transparent)",
    borderRadius: "8px",
    boxSizing: "border-box",
    color: "CanvasText",
    font: "12px ui-monospace, SFMono-Regular, Consolas, monospace",
    padding: "10px",
    resize: "vertical",
    width: "100%",
  });

  const status = document.createElement("p");
  status.setAttribute("aria-live", "polite");
  Object.assign(status.style, {
    lineHeight: "1.4",
    margin: "10px 0 0",
    minHeight: "20px",
  });

  const actions = document.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    gap: "10px",
    justifyContent: "flex-end",
    marginTop: "16px",
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  Object.assign(cancel.style, {
    background: "transparent",
    border: "1px solid color-mix(in srgb, CanvasText 25%, transparent)",
    borderRadius: "8px",
    color: "CanvasText",
    cursor: "pointer",
    padding: "9px 14px",
  });

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Complete authorization";
  Object.assign(submit.style, {
    background: "#10a37f",
    border: "0",
    borderRadius: "8px",
    color: "white",
    cursor: "pointer",
    padding: "10px 14px",
  });

  const dismiss = (): void => {
    input.value = "";
    if (manualOAuthCallbackPrompt?.requestId) {
      oauthCallbackRequestIds.delete(manualOAuthCallbackPrompt.requestId);
    }
    overlay.remove();
    if (manualOAuthCallbackPrompt?.dismiss === dismiss) {
      manualOAuthCallbackPrompt = null;
    }
  };

  cancel.addEventListener("click", dismiss);
  overlay.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const callbackUrl = parseManualOAuthCallbackUrl(input.value);
      const requestId = crypto.randomUUID();
      oauthCallbackRequestIds.add(requestId);
      if (manualOAuthCallbackPrompt) {
        manualOAuthCallbackPrompt.requestId = requestId;
      }
      input.disabled = true;
      submit.disabled = true;
      status.textContent = "Sending the callback to this Codex Web instance…";
      status.style.color = "CanvasText";
      enqueueMessage({
        type: "oauth-callback-forward",
        requestId,
        callback: callbackUrl,
      });
    } catch (error) {
      status.textContent =
        error instanceof Error
          ? error.message
          : "The callback URL could not be used.";
      status.style.color = "#d93025";
    }
  });

  actions.append(cancel, submit);
  form.append(label, input, status, actions);
  card.append(title, detail, form);
  overlay.append(card);
  getActiveModalMountTarget().append(overlay);
  manualOAuthCallbackPrompt = {
    dismiss,
    input,
    requestId: null,
    status,
    submit,
  };
  window.setTimeout(() => {
    if (input.isConnected) {
      input.focus();
    }
  }, 0);
}

function showExternalLinkPrompt(url: string, afterOpen?: () => void): void {
  externalLinkPrompt?.remove();

  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "codex-web-external-link-title");
  Object.assign(overlay.style, {
    alignItems: "center",
    background: "rgb(0 0 0 / 45%)",
    display: "flex",
    inset: "0",
    justifyContent: "center",
    padding: "24px",
    position: "fixed",
    zIndex: "2147483647",
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    background: "Canvas",
    border: "1px solid color-mix(in srgb, CanvasText 20%, transparent)",
    borderRadius: "12px",
    boxShadow: "0 18px 55px rgb(0 0 0 / 25%)",
    color: "CanvasText",
    font: "14px system-ui, sans-serif",
    maxWidth: "420px",
    padding: "24px",
    width: "100%",
  });

  const title = document.createElement("h2");
  title.id = "codex-web-external-link-title";
  title.textContent = "Continue authorization";
  Object.assign(title.style, {
    fontSize: "18px",
    margin: "0 0 8px",
  });

  const detail = document.createElement("p");
  detail.textContent =
    "Your browser blocked the automatic authorization tab. Continue with this direct link.";
  Object.assign(detail.style, {
    lineHeight: "1.5",
    margin: "0 0 18px",
    opacity: "0.75",
  });

  const actions = document.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    gap: "10px",
    justifyContent: "flex-end",
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  Object.assign(cancel.style, {
    background: "transparent",
    border: "1px solid color-mix(in srgb, CanvasText 25%, transparent)",
    borderRadius: "8px",
    color: "CanvasText",
    cursor: "pointer",
    padding: "9px 14px",
  });
  const dismiss = (): void => {
    overlay.remove();
    if (externalLinkPrompt === overlay) {
      externalLinkPrompt = null;
    }
  };
  cancel.addEventListener("click", dismiss);

  const continueLink = document.createElement("a");
  continueLink.href = url;
  continueLink.target = "_blank";
  continueLink.rel = "noopener noreferrer";
  continueLink.textContent = "Continue on auth.openai.com";
  Object.assign(continueLink.style, {
    background: "#10a37f",
    borderRadius: "8px",
    color: "white",
    padding: "10px 14px",
    textDecoration: "none",
  });
  continueLink.addEventListener("click", () => {
    window.setTimeout(() => {
      dismiss();
      afterOpen?.();
    }, 0);
  });

  actions.append(cancel, continueLink);
  card.append(title, detail, actions);
  overlay.append(card);
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dismiss();
    }
  });
  document.body.append(overlay);
  externalLinkPrompt = overlay;
  continueLink.focus();
}

function openExternalUrl(url: string): void {
  const parsedUrl = new URL(url);
  if (!new Set(["http:", "https:"]).has(parsedUrl.protocol)) {
    throw new Error(
      `[electron-stub] refusing external URL protocol ${parsedUrl.protocol}`,
    );
  }

  const popup = window.open(parsedUrl.toString(), "_blank");
  if (popup) {
    popup.opener = null;
    if (isRemoteControlAuthorizationUrl(parsedUrl)) {
      showManualOAuthCallbackPrompt();
    }
    return;
  }
  showExternalLinkPrompt(
    parsedUrl.toString(),
    isRemoteControlAuthorizationUrl(parsedUrl)
      ? showManualOAuthCallbackPrompt
      : undefined,
  );
}

export function emitRendererEvent(channel: string, args: unknown[]): void {
  const listeners = rendererListeners.get(channel);
  if (!listeners || listeners.size === 0) {
    return;
  }
  const event = { sender: null };
  for (const listener of listeners) {
    listener(event, ...args);
  }
}

let lastBrowserWindowFocusState: boolean | null = null;

function getBrowserWindowFocusState(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function installBrowserWindowFocusListeners(): void {
  const handleFocusChange = () => {
    const isFocused = getBrowserWindowFocusState();
    if (isFocused === lastBrowserWindowFocusState) {
      return;
    }

    lastBrowserWindowFocusState = isFocused;
    emitRendererEvent("codex_desktop:message-for-view", [
      {
        type: "electron-window-focus-changed",
        isFocused,
      },
    ]);
  };

  window.addEventListener("focus", handleFocusChange);
  window.addEventListener("blur", handleFocusChange);
  document.addEventListener("visibilitychange", handleFocusChange);
}

installBrowserWindowFocusListeners();

function handleIncomingMessage(message: MainToRendererMessage): void {
  if (message.type === "ipc-main-event") {
    emitRendererEvent(message.channel, message.args);
    return;
  }

  if (message.type === "open-external") {
    openExternalUrl(message.url);
    return;
  }

  if (message.type === "ipc-renderer-invoke-result") {
    const pending = pendingInvokes.get(message.requestId);
    if (!pending) {
      return;
    }
    pendingInvokes.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.result);
      return;
    }
    pending.reject(new Error(message.errorMessage));
    return;
  }

  if (message.type === "message-port-message") {
    messagePorts.get(message.portId)?.postMessage(message.data);
    return;
  }

  if (message.type === "message-port-close") {
    const port = messagePorts.get(message.portId);
    messagePorts.delete(message.portId);
    port?.close();
    return;
  }

  if (message.type === "workspace-directory-entries-result") {
    const pending = pendingDirectoryEntries.get(message.requestId);
    if (!pending) {
      return;
    }
    pendingDirectoryEntries.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.result);
      return;
    }
    pending.reject(new Error(message.errorMessage));
    return;
  }

  if (message.type === "oauth-callback-forward-result") {
    oauthCallbackRequestIds.delete(message.requestId);
    const prompt = manualOAuthCallbackPrompt;
    if (prompt) {
      if (prompt.requestId === message.requestId) {
        prompt.requestId = null;
        if (message.ok) {
          prompt.input.value = "";
          prompt.status.textContent =
            "Callback accepted. Remote-control enrollment is finishing…";
          prompt.status.style.color = "#188038";
          window.setTimeout(prompt.dismiss, 1_500);
        } else {
          prompt.input.disabled = false;
          prompt.submit.disabled = false;
          prompt.status.textContent = message.errorMessage;
          prompt.status.style.color = "#d93025";
          prompt.input.focus();
        }
      } else if (message.ok) {
        prompt.status.textContent =
          "Callback accepted. Remote-control enrollment is finishing…";
        prompt.status.style.color = "#188038";
        window.setTimeout(prompt.dismiss, 1_500);
      }
    }
    oauthCallbackChannel?.postMessage({
      type: "codex-web-oauth-callback-result",
      requestId: message.requestId,
      ok: message.ok,
      ...(message.ok ? {} : { errorMessage: message.errorMessage }),
    });
  }
}

function flushOutboundQueue(): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  for (const message of outboundQueue.splice(0)) {
    socket.send(JSON.stringify(message));
  }
}

function showRendererTakeoverNotice(): void {
  if (document.querySelector("[data-codex-web-renderer-takeover]")) {
    return;
  }
  const notice = document.createElement("div");
  notice.dataset.codexWebRendererTakeover = "true";
  notice.setAttribute("role", "alert");
  notice.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "background:#f7f7f5",
    "color:#202123",
    "font:16px/1.5 system-ui,sans-serif",
  ].join(";");
  notice.innerHTML =
    '<div style="max-width:32rem;padding:2rem;text-align:center">' +
    '<h1 style="font-size:1.25rem;margin:0 0 .75rem">Codex is open in another tab</h1>' +
    '<p style="margin:0 0 1.25rem">This tab was disconnected so the newer tab can use the Codex session.</p>' +
    '<button type="button" style="border:0;border-radius:.5rem;background:#111;color:#fff;padding:.65rem 1rem;cursor:pointer">Use Codex in this tab</button>' +
    "</div>";
  notice.querySelector("button")?.addEventListener("click", () => {
    window.location.reload();
  });
  document.body.append(notice);
}

function scheduleReconnect(): void {
  if (reconnectTimeoutId !== null) {
    return;
  }
  reconnectTimeoutId = window.setTimeout(() => {
    reconnectTimeoutId = null;
    ensureSocket();
  }, RECONNECT_DELAY_MS);
}

function ensureSocket(): void {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  socket = new WebSocket(
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/__backend/ipc`,
  );
  socket.addEventListener("open", () => {
    flushOutboundQueue();
  });
  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data)) as MainToRendererMessage;
      handleIncomingMessage(message);
    } catch (error) {
      console.error(
        "[electron-stub] failed to parse IPC bridge message",
        error,
      );
    }
  });
  socket.addEventListener("close", (event) => {
    for (const port of messagePorts.values()) {
      port.close();
    }
    messagePorts.clear();
    if (event.code === RENDERER_TAKEOVER_CLOSE_CODE) {
      showRendererTakeoverNotice();
      return;
    }
    scheduleReconnect();
  });
  socket.addEventListener("error", () => {
    // A WebSocket error is followed by a close event. Only the close event has
    // the status code needed to distinguish a transient disconnect from an
    // intentional renderer takeover.
  });
}

function enqueueMessage(message: RendererToMainMessage): void {
  outboundQueue.push(message);
  ensureSocket();
  flushOutboundQueue();
}

function nextRequestId(): string {
  requestCounter += 1;
  return `ipc_bridge_${requestCounter}`;
}

function invokeMain(channel: string, args: unknown[]): Promise<unknown> {
  const requestId = nextRequestId();
  return new Promise((resolve, reject) => {
    pendingInvokes.set(requestId, { resolve, reject });
    enqueueMessage({
      type: "ipc-renderer-invoke",
      requestId,
      channel,
      args,
    });
  });
}

function addIpcListener(channel: string, listener: IpcListener): void {
  const listeners = rendererListeners.get(channel) ?? new Set<IpcListener>();
  listeners.add(listener);
  rendererListeners.set(channel, listeners);
}

function shouldCloseSidebarForMemoryPath(path: string): boolean {
  return (
    path === "/" ||
    path.startsWith("/local/") ||
    path === "/skills" ||
    path === "/automations"
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type WebNotificationPayload = {
  body?: string;
  id?: string;
  kind: string;
  title: string;
};

async function showWebNotification(
  notification: WebNotificationPayload,
): Promise<void> {
  if (typeof Notification === "undefined") {
    console.warn("[codex-web] Web Notifications API unavailable");
    return;
  }

  try {
    const permission = Notification.permission;
    if (permission !== "granted") {
      console.warn("[codex-web] notification permission", permission);
      return;
    }

    const webNotification = new Notification(notification.title, {
      body: notification.body,
      tag: notification.id,
    });
    webNotification.onclick = () => {
      window.focus();
      webNotification.close();
    };
    console.log("[codex-web] notification shown", notification);
  } catch (error) {
    console.error("[codex-web] failed to show notification", error);
  }
}

function handleNotificationShowMessage(value: unknown): void {
  if (typeof value !== "string") {
    return;
  }

  try {
    const message = JSON.parse(value) as unknown;
    if (
      !Array.isArray(message) ||
      message[0] !== "push" ||
      !Array.isArray(message[1])
    ) {
      return;
    }

    const pipeline = message[1];
    const method = pipeline[2];
    const args = pipeline[3];
    const notification = Array.isArray(args) ? args[0] : null;
    if (
      pipeline[0] === "pipeline" &&
      Array.isArray(method) &&
      method[0] === "show" &&
      isRecord(notification) &&
      typeof notification.kind === "string" &&
      typeof notification.title === "string" &&
      (notification.body === undefined ||
        typeof notification.body === "string") &&
      (notification.id === undefined || typeof notification.id === "string")
    ) {
      void showWebNotification({
        body: notification.body,
        id: notification.id,
        kind: notification.kind,
        title: notification.title,
      });
    }
  } catch {
    // Ignore non-JSON MessagePort traffic.
  }
}

function isUnhandledAddWorkspaceRootOptionMessage(value: unknown): value is {
  root?: unknown;
  type: "electron-add-new-workspace-root-option";
} {
  return (
    isRecord(value) &&
    value.type === "electron-add-new-workspace-root-option" &&
    typeof value.root !== "string"
  );
}

function isOpenInBrowserMessage(value: unknown): value is {
  type: "open-in-browser";
  url: string;
} {
  return (
    isRecord(value) &&
    value.type === "open-in-browser" &&
    typeof value.url === "string"
  );
}

function isElectronWindowFocusRequestMessage(value: unknown): value is {
  type: "electron-window-focus-request";
} {
  return isRecord(value) && value.type === "electron-window-focus-request";
}

function requestWorkspaceDirectoryEntries(
  directoryPath: string | null,
): Promise<WorkspaceDirectoryEntries> {
  const requestId = nextRequestId();
  return new Promise((resolve, reject) => {
    pendingDirectoryEntries.set(requestId, { resolve, reject });
    enqueueMessage({
      type: "workspace-directory-entries-request",
      requestId,
      directoryPath,
      directoriesOnly: true,
    });
  });
}

const themeMediaQuery = matchMedia("(prefers-color-scheme: dark)");
const mobileMediaQuery = matchMedia("(max-width: 768px)");
const initialSidebarState = !mobileMediaQuery.matches;
const electronShim = (window.__ELECTRON_SHIM__ ??= {});
const buildFlavor: "prod" | "dev" | "agent" | string = "prod";

Object.assign(globalThis, {
  process: {
    arch: "arm64",
    platform: "darwin",
    versions: {
      electron: "41.2.0",
    },
  },
});

electronShim.overrideAdapter = {
  getGateOverride(evaluation) {
    if (evaluation.name === "2911712394") {
      return {
        ...evaluation,
        value: true,
      };
    }

    if (evaluation.name === "1042620455") {
      // Remote control (Slingshot).
      return {
        ...evaluation,
        value: true,
      };
    }

    return null;
  },
};

const initialRoute = mapBrowserPathToInitialRoute(
  window.location.pathname,
  window.location.search,
);
electronShim.initialRoute = initialRoute.memoryPath;

if (initialRoute.browserPath) {
  window.history.pushState(undefined, "", initialRoute.browserPath);
}

electronShim.initialSidebarState = initialSidebarState;
electronShim.onMemoryNavigationChanged = (navigation) => {
  const path = navigation.location.pathname;
  if (
    navigation.action !== "POP" &&
    mobileMediaQuery.matches &&
    shouldCloseSidebarForMemoryPath(path)
  ) {
    electronShim.closeSidebar?.();
  }

  const browserPath = mapMemoryPathToBrowserPath(path);
  if (browserPath == null) {
    return;
  }

  if (browserPath.titleChange) {
    document.title = browserPath.titleChange;
  }

  if (window.location.pathname === browserPath.path) {
    window.history.replaceState(undefined, "", browserPath.path);
    return;
  }

  window.history.pushState(undefined, "", browserPath.path);
};

export const ipcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (channel === "codex_desktop:message-from-view" && args.length === 1) {
      if (isElectronWindowFocusRequestMessage(args[0])) {
        const isFocused = getBrowserWindowFocusState();
        lastBrowserWindowFocusState = isFocused;
        emitRendererEvent("codex_desktop:message-for-view", [
          {
            type: "electron-window-focus-changed",
            isFocused,
          },
        ]);
        return Promise.resolve(undefined);
      }

      if (isOpenInBrowserMessage(args[0])) {
        window.open(args[0].url, "_blank", "noopener,noreferrer");
        return Promise.resolve(undefined);
      }

      if (isLocalFilePickerMessage(args[0])) {
        return handleLocalFilePickerMessage(args[0]);
      }

      if (isUnhandledAddWorkspaceRootOptionMessage(args[0])) {
        return openSelectWorkspaceRootDialog({
          listDirectory: requestWorkspaceDirectoryEntries,
        }).then((root) => {
          if (!root) {
            return undefined;
          }

          return invokeMain(channel, [{ ...args[0], root }]);
        });
      }
    }

    return invokeMain(channel, args);
  },
  on(channel: string, listener: IpcListener): unknown {
    addIpcListener(channel, listener);
    return this;
  },
  once(channel: string, listener: IpcListener): unknown {
    const wrapped: IpcListener = (event, ...args) => {
      this.removeListener(channel, wrapped);
      listener(event, ...args);
    };
    addIpcListener(channel, wrapped);
    return this;
  },
  addListener(channel: string, listener: IpcListener): unknown {
    addIpcListener(channel, listener);
    return this;
  },
  removeListener(channel: string, listener: IpcListener): unknown {
    rendererListeners.get(channel)?.delete(listener);
    return this;
  },
  off(channel: string, listener: IpcListener): unknown {
    return this.removeListener(channel, listener);
  },
  send(channel: string, ...args: unknown[]): void {
    enqueueMessage({
      type: "ipc-renderer-send",
      channel,
      args,
    });
  },
  postMessage(
    channel: string,
    message: unknown,
    transfer?: Transferable[],
  ): void {
    if (transfer && transfer.length > 0) {
      const portIds = transfer.map((transferable) => {
        if (!(transferable instanceof MessagePort)) {
          throw new TypeError(
            "Only MessagePort transfers are supported by the browser IPC bridge.",
          );
        }

        const portId = `message_port_${nextRequestId()}`;
        messagePorts.set(portId, transferable);
        transferable.addEventListener("message", (event) => {
          if (channel === "codex_desktop:connect-app-host") {
            handleNotificationShowMessage(event.data);
          }
          enqueueMessage({
            type: "message-port-message",
            portId,
            data: event.data,
          });
        });
        transferable.addEventListener("messageerror", () => {
          messagePorts.delete(portId);
          enqueueMessage({ type: "message-port-close", portId });
        });
        transferable.start();
        return portId;
      });

      enqueueMessage({
        type: "ipc-renderer-post-message",
        channel,
        message,
        portIds,
      });
      return;
    }

    enqueueMessage({
      type: "ipc-renderer-send",
      channel,
      args: [message],
    });
  },
  sendSync(channel: string, ..._args: unknown[]): unknown {
    if (channel === "codex_desktop:get-sentry-init-options") {
      return {
        codexAppSessionId: "42626fde-7064-471f-b44d-b1a7ad849c7f",
        buildFlavor,
        buildNumber: null,
        appVersion: __CODEX_APP_VERSION__,
        enabled: false,
      };
    }

    if (channel === "codex_desktop:get-build-flavor") {
      return buildFlavor;
    }

    if (channel === "codex_desktop:get-uses-owl-app-shell") {
      return false;
    }

    if (channel === "codex_desktop:get-shared-object-snapshot") {
      return {
        host_config: { id: "local", display_name: "Local", kind: "local" },
        remote_ssh_connections: [],
        remote_wsl_connections: [],
        remote_control_connections_state: {
          available: false,
          accessRequired: false,
          authRequired: false,
          clientAuthorized: false,
        },
        local_remote_control_client_id: null,
        pending_worktrees: [],
      };
    }

    if (channel === "codex_desktop:get-initial-sidebar-bootstrap") {
      return null;
    }

    if (channel === "codex_desktop:get-system-theme-variant") {
      return themeMediaQuery.matches ? "dark" : "light";
    }

    return unimplemented("ipcRenderer.sendSync");
  },
};

ensureSocket();

export const contextBridge = {
  exposeInMainWorld(_key: string, _api: unknown): void {
    Reflect.set(window, _key, _api);
  },
};

export const webUtils = {
  getPathForFile(_file: File): string | null {
    return unimplemented("webUtils.getPathForFile");
  },
};
