import http from "node:http";

export const REMOTE_CONTROL_OAUTH_CALLBACK_PATH = "/auth/callback";
export const REMOTE_CONTROL_OAUTH_CALLBACK_PORTS = new Set([1455, 1457]);
export const REMOTE_CONTROL_OAUTH_CHANNEL = "codex-web-oauth-callback";
export const REMOTE_CONTROL_OAUTH_COMPLETE_PATH =
  "/__backend/oauth/remote-control-complete";

const MAX_CALLBACK_SEARCH_LENGTH = 16_384;

export type RemoteControlOAuthCallback = {
  path: string;
  port: number;
  search: string;
};

export function parseRemoteControlOAuthCallback(
  value: unknown,
): RemoteControlOAuthCallback {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid remote-control OAuth callback");
  }

  const callback = value as Record<string, unknown>;
  const port = callback.port;
  const callbackPath = callback.path;
  const search = callback.search;

  if (
    typeof port !== "number" ||
    !REMOTE_CONTROL_OAUTH_CALLBACK_PORTS.has(port)
  ) {
    throw new Error("Unsupported remote-control OAuth callback port");
  }
  if (callbackPath !== REMOTE_CONTROL_OAUTH_CALLBACK_PATH) {
    throw new Error("Unsupported remote-control OAuth callback path");
  }
  if (
    typeof search !== "string" ||
    search.length === 0 ||
    search.length > MAX_CALLBACK_SEARCH_LENGTH ||
    !search.startsWith("?")
  ) {
    throw new Error("Invalid remote-control OAuth callback query");
  }

  const params = new URLSearchParams(search);
  if (!params.has("state")) {
    throw new Error("Remote-control OAuth callback is missing state");
  }
  if (!params.has("code") && !params.has("error")) {
    throw new Error("Remote-control OAuth callback is missing a result");
  }

  return {
    path: callbackPath,
    port,
    search,
  };
}

export async function forwardRemoteControlOAuthCallback(
  callback: RemoteControlOAuthCallback,
  options: {
    host?: string;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const host = options.host ?? "127.0.0.1";
  const timeoutMs = options.timeoutMs ?? 10_000;

  await new Promise<void>((resolve, reject) => {
    const request = http.request(
      {
        host,
        port: callback.port,
        path: `${callback.path}${callback.search}`,
        method: "GET",
        headers: {
          Connection: "close",
          Host: `localhost:${callback.port}`,
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          const statusCode = response.statusCode ?? 500;
          if (statusCode >= 200 && statusCode < 300) {
            resolve();
            return;
          }
          reject(
            new Error(
              `Remote-control OAuth callback was rejected (${statusCode})`,
            ),
          );
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Remote-control OAuth callback timed out"));
    });
    request.once("error", reject);
    request.end();
  });
}

export function remoteControlOAuthCompleteHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="light dark">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Completing remote-control authorization</title>
    <style>
      body { align-items: center; display: flex; font: 16px system-ui, sans-serif; justify-content: center; margin: 0; min-height: 100vh; }
      main { max-width: 34rem; padding: 2rem; text-align: center; }
      p { opacity: .72; }
    </style>
  </head>
  <body>
    <main>
      <h1 id="heading">Completing authorization…</h1>
      <p id="detail">Keep the Codex Web tab open.</p>
    </main>
    <script>
      (() => {
        const channelName = ${JSON.stringify(REMOTE_CONTROL_OAUTH_CHANNEL)};
        const heading = document.getElementById("heading");
        const detail = document.getElementById("detail");
        const fragment = new URLSearchParams(location.hash.slice(1));
        const requestId = fragment.get("requestId") || crypto.randomUUID();
        const port = Number(fragment.get("port"));
        const path = fragment.get("path");
        const search = fragment.get("search");
        const channel = new BroadcastChannel(channelName);
        let finished = false;

        const finish = (ok, message) => {
          if (finished) return;
          finished = true;
          clearInterval(retry);
          clearTimeout(timeout);
          heading.textContent = ok
            ? "Remote control authorized"
            : "Authorization could not be completed";
          detail.textContent = ok
            ? "You can close this tab and return to Codex Web."
            : message || "Return to Codex Web and try again.";
        };

        channel.onmessage = (event) => {
          const value = event.data;
          if (
            value &&
            value.type === "codex-web-oauth-callback-result" &&
            value.requestId === requestId
          ) {
            finish(value.ok === true, value.errorMessage);
          }
        };

        const callback = {
          type: "codex-web-oauth-callback",
          requestId,
          callback: { port, path, search },
        };
        const send = () => channel.postMessage(callback);
        const retry = setInterval(send, 500);
        const timeout = setTimeout(
          () => finish(false, "The Codex Web tab did not receive the callback."),
          30_000,
        );
        send();
      })();
    </script>
  </body>
</html>`;
}
