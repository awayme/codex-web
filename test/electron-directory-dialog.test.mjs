import assert from "node:assert/strict";
import test from "node:test";
import electron from "../src/server/electron/index.js";

const bridge = globalThis.__codexElectronIpcBridge;
const resultChannel = "codex-web:directory-dialog-result";

test("directory dialogs route multiple selections only through the owning tab", async () => {
  const owner = new electron.BrowserWindow({ show: false });
  const other = new electron.BrowserWindow({ show: true });
  let request;
  bridge.sendToRenderer = (id, message) => {
    assert.equal(id, owner.webContents.id);
    assert.equal(message.channel, "codex-web:directory-dialog");
    request = message.args[0];
    return true;
  };
  try {
    const pending = electron.dialog.showOpenDialog(owner, {
      title: "Select Project Root",
      properties: ["openDirectory", "multiSelections"],
    });
    assert.equal(request.allowMultiple, true);
    assert.equal(request.title, "Select Project Root");
    let completed = false;
    pending.then(() => {
      completed = true;
    });
    const result = { canceled: false, filePaths: ["/project-a", "/project-b"] };
    await bridge.handleRendererInvoke(
      resultChannel,
      [request.requestId, result],
      other.id,
    );
    assert.equal(completed, false);
    await bridge.handleRendererInvoke(
      resultChannel,
      [request.requestId, result],
      owner.id,
    );
    assert.deepEqual(await pending, result);
  } finally {
    owner.destroy();
    other.destroy();
  }
});

test("directory dialogs without an explicit window preserve async IPC ownership", async () => {
  const owner = new electron.BrowserWindow({ show: false });
  const other = new electron.BrowserWindow({ show: true });
  let request;
  bridge.sendToRenderer = (id, message) => {
    assert.equal(id, owner.webContents.id);
    request = message.args[0];
    return true;
  };
  const channel = "test:open-directory";
  electron.ipcMain.handle(channel, async () => {
    await Promise.resolve();
    return electron.dialog.showOpenDialog({ properties: ["openDirectory"] });
  });
  try {
    const pending = bridge.handleRendererInvoke(channel, [], owner.id);
    await new Promise(setImmediate);
    assert.equal(request.allowMultiple, false);
    await bridge.handleRendererInvoke(
      resultChannel,
      [
        request.requestId,
        {
          canceled: false,
          filePaths: ["/project-a"],
        },
      ],
      owner.id,
    );
    assert.deepEqual(await pending, {
      canceled: false,
      filePaths: ["/project-a"],
    });
  } finally {
    electron.ipcMain.removeHandler(channel);
    owner.destroy();
    other.destroy();
  }
});

test("cancellation and closing a tab resolve pending directory dialogs", async () => {
  const owner = new electron.BrowserWindow({ show: true });
  let request;
  bridge.sendToRenderer = (_id, message) => {
    request = message.args[0];
    return true;
  };
  try {
    const pending = electron.dialog.showOpenDialog(owner, {
      properties: ["openDirectory"],
    });
    await bridge.handleRendererInvoke(
      resultChannel,
      [
        request.requestId,
        {
          canceled: true,
          filePaths: [],
        },
      ],
      owner.id,
    );
    assert.deepEqual(await pending, { canceled: true, filePaths: [] });
    const disconnected = electron.dialog.showOpenDialog(owner, {
      properties: ["openDirectory"],
    });
    owner.destroy();
    assert.deepEqual(await disconnected, { canceled: true, filePaths: [] });
  } finally {
    owner.destroy();
  }
});

test("directory dialogs fail clearly without a renderer and reject file picker requests", async () => {
  const owner = new electron.BrowserWindow({ show: true });
  bridge.sendToRenderer = () => false;
  try {
    await assert.rejects(
      electron.dialog.showOpenDialog(owner, { properties: ["openDirectory"] }),
      /No browser renderer/,
    );
    await assert.rejects(
      electron.dialog.showOpenDialog(owner, { properties: ["openFile"] }),
      /Only directory dialogs/,
    );
  } finally {
    owner.destroy();
  }
});
