import assert from "node:assert/strict";
import test from "node:test";

import electron from "../src/server/electron/index.js";

test("Electron shell forwards HTTPS URLs to the browser renderer", async () => {
  let received;
  globalThis.__codexElectronIpcBridge = {
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
