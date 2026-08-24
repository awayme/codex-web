import assert from "node:assert/strict";
import test from "node:test";

import electron from "../src/server/electron/index.js";

test("Electron shell forwards HTTPS URLs to the browser renderer", async () => {
  let received;
  globalThis.__codexElectronIpcBridge = {
    ...globalThis.__codexElectronIpcBridge,
    broadcastToRenderer(message) {
      received = message;
    },
  };

  await electron.shell.openExternal("https://auth.openai.com/oauth/authorize");

  assert.deepEqual(received, {
    type: "open-external",
    url: "https://auth.openai.com/oauth/authorize",
  });
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
  assert.equal(electron.powerMonitor.getSystemIdleState(1), "active");
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

  globalThis.__codexElectronIpcBridge.handleRendererSend(
    channel,
    [],
    undefined,
    "renderer-session-test",
  );

  assert.equal(sender.id, 1001);
  assert.equal(sender.isDestroyed(), false);
  globalThis.__codexElectronIpcBridge.handleRendererDisconnected(
    "renderer-session-test",
  );
  assert.equal(sender.isDestroyed(), true);
  assert.equal(destroyedCount, 1);

  electron.ipcMain.off(channel, listener);
});
