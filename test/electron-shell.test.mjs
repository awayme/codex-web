import assert from "node:assert/strict";
import test from "node:test";

import electron from "../src/server/electron/index.js";

test("Electron shell forwards HTTPS URLs to the browser renderer", async () => {
  let received;
  const window = new electron.BrowserWindow({ show: true });
  globalThis.__codexElectronIpcBridge = {
    ...globalThis.__codexElectronIpcBridge,
    sendToRenderer(webContentsId, message) {
      assert.equal(webContentsId, window.webContents.id);
      received = message;
      return true;
    },
  };

  await electron.shell.openExternal("https://auth.openai.com/oauth/authorize");

  assert.deepEqual(received, {
    type: "open-external",
    url: "https://auth.openai.com/oauth/authorize",
  });
  window.destroy();
});

test("Electron shell rejects unsafe external URL protocols", async () => {
  await assert.rejects(
    electron.shell.openExternal("javascript:alert(1)"),
    /Unsupported external URL protocol/u,
  );
});

test("BrowserWindow preserves visibility through webContents lookup", () => {
  const BrowserWindow = electron.BrowserWindow;
  const browserWindow = new BrowserWindow({ show: false });
  const resolvedWindow = BrowserWindow.fromWebContents(
    browserWindow.webContents,
  );

  assert.ok(resolvedWindow);
  assert.equal(typeof resolvedWindow.isVisible, "function");
  assert.equal(resolvedWindow.isVisible(), false);

  resolvedWindow.show();
  assert.equal(resolvedWindow.isVisible(), true);

  resolvedWindow.hide();
  assert.equal(resolvedWindow.isVisible(), false);

  resolvedWindow.destroy();
  assert.equal(resolvedWindow.isVisible(), false);
});

test("BrowserWindow emits ready-to-show after its first load", async () => {
  const BrowserWindow = electron.BrowserWindow;
  const browserWindow = new BrowserWindow({ show: false });
  let readyToShowCount = 0;

  browserWindow.once("ready-to-show", () => {
    readyToShowCount += 1;
    browserWindow.show();
  });

  await browserWindow.loadURL("http://localhost:5175/");
  await Promise.resolve();

  assert.equal(readyToShowCount, 1);
  assert.equal(browserWindow.isVisible(), true);
  assert.equal(browserWindow.isFocused(), true);

  await browserWindow.loadURL("http://localhost:5175/again");
  await Promise.resolve();
  assert.equal(readyToShowCount, 1);

  browserWindow.destroy();
});

test("powerMonitor reports stable AC power in the hosted shell", () => {
  assert.equal(electron.powerMonitor.isOnBatteryPower(), false);
  assert.equal(electron.powerMonitor.getSystemIdleState(1), "unknown");
});

test("systemPreferences is present without unsupported native font APIs", () => {
  assert.equal(typeof electron.systemPreferences, "object");
  assert.equal(electron.systemPreferences.getFontFamilies, undefined);
});

test("hosted desktop service stubs are safe and deterministic", async () => {
  electron.clipboard.writeText("hosted clipboard");
  assert.equal(electron.clipboard.readText(), "hosted clipboard");
  assert.deepEqual(electron.clipboard.availableFormats(), ["text/plain"]);

  assert.equal(
    electron.globalShortcut.register("CommandOrControl+Shift+P", () => {}),
    false,
  );
  const blockerId = electron.powerSaveBlocker.start("prevent-app-suspension");
  assert.equal(electron.powerSaveBlocker.isStarted(blockerId), true);
  electron.powerSaveBlocker.stop(blockerId);
  assert.equal(electron.powerSaveBlocker.isStarted(blockerId), false);

  await electron.contentTracing.startRecording({
    recording_mode: "record-continuously",
  });
  assert.equal(
    await electron.contentTracing.stopRecording("/tmp/trace.json"),
    "/tmp/trace.json",
  );
});

test("renderer sessions receive isolated destroyed lifecycles", () => {
  const first = new electron.BrowserWindow({ show: false });
  const second = new electron.BrowserWindow({ show: false });
  const channel = "codex_web:test-renderer-session";
  let sender;
  let destroyedCount = 0;
  const listener = (event) => {
    sender = event.sender;
    sender.once("destroyed", () => {
      destroyedCount += 1;
    });
  };
  electron.ipcMain.on(channel, listener);

  globalThis.__codexElectronIpcBridge.handleRendererSend(channel, [], first.id);

  assert.equal(sender.id, first.webContents.id);
  assert.equal(sender.isDestroyed(), false);
  first.destroy();
  assert.equal(sender.isDestroyed(), true);
  assert.equal(destroyedCount, 1);
  assert.equal(second.isDestroyed(), false);
  assert.equal(electron.BrowserWindow.fromId(first.id), null);
  second.destroy();

  electron.ipcMain.off(channel, listener);
});

test("external URLs stay with the originating tab across concurrent async IPC", async () => {
  const first = new electron.BrowserWindow({ show: false });
  const second = new electron.BrowserWindow({ show: true });
  const messages = [];
  const bridge = globalThis.__codexElectronIpcBridge;
  bridge.sendToRenderer = (id, message) => {
    messages.push({ id, message });
    return true;
  };
  const channel = "codex_web:test-open-external";
  let releaseFirst;
  const firstWait = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  electron.ipcMain.handle(channel, async (_event, url, wait) => {
    if (wait) await firstWait;
    await electron.shell.openExternal(url);
  });
  try {
    const firstCall = bridge.handleRendererInvoke(
      channel,
      ["https://example.com/first", true],
      first.id,
    );
    await bridge.handleRendererInvoke(
      channel,
      ["https://example.com/second", false],
      second.id,
    );
    releaseFirst();
    await firstCall;
    assert.deepEqual(messages, [
      {
        id: second.webContents.id,
        message: { type: "open-external", url: "https://example.com/second" },
      },
      {
        id: first.webContents.id,
        message: { type: "open-external", url: "https://example.com/first" },
      },
    ]);
    bridge.sendToRenderer = () => false;
    await assert.rejects(
      bridge.handleRendererInvoke(
        channel,
        ["https://example.com/disconnected", false],
        first.id,
      ),
      /No browser renderer is connected/,
    );
  } finally {
    releaseFirst();
    electron.ipcMain.removeHandler(channel);
    first.destroy();
    second.destroy();
  }
});

test("app-host MessagePort callbacks keep their originating tab", async () => {
  const first = new electron.BrowserWindow({ show: false });
  const second = new electron.BrowserWindow({ show: true });
  const messages = [];
  const bridge = globalThis.__codexElectronIpcBridge;
  bridge.sendToRenderer = (id, message) => {
    messages.push({ id, message });
    return true;
  };
  const channel = "codex_web:test-port-context";
  let receive;
  const port = {
    on(_event, listener) {
      receive = listener;
    },
    close() {},
    postMessage() {},
    start() {},
  };
  const listener = (event) =>
    event.ports[0].on("message", async () => {
      await Promise.resolve();
      await electron.shell.openExternal("https://example.com/port");
    });
  electron.ipcMain.on(channel, listener);
  try {
    bridge.handleRendererPostMessage(channel, {}, [port], first.id);
    await receive({ data: "open" });
    assert.deepEqual(messages, [
      {
        id: first.webContents.id,
        message: { type: "open-external", url: "https://example.com/port" },
      },
    ]);
  } finally {
    electron.ipcMain.off(channel, listener);
    first.destroy();
    second.destroy();
  }
});
