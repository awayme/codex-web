import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  getCodexWebDataDir,
  getElectronPath,
} from "../src/server/electron/paths.js";

test("uses CODEX_WEB_DATA_DIR for writable Electron state", () => {
  assert.equal(
    getCodexWebDataDir({
      dataDir: "/var/lib/codex-web",
      homeDir: "/home/codex",
    }),
    "/var/lib/codex-web",
  );
  assert.equal(
    getElectronPath("userData", {
      dataDir: "/var/lib/codex-web",
      homeDir: "/home/codex",
    }),
    "/var/lib/codex-web",
  );
  assert.equal(
    getElectronPath("crashDumps", {
      dataDir: "/var/lib/codex-web",
      homeDir: "/home/codex",
    }),
    "/var/lib/codex-web/crash-dumps",
  );
});

test("keeps home-scoped paths on the container user home", () => {
  assert.equal(
    getElectronPath("home", { homeDir: "/home/codex" }),
    "/home/codex",
  );
  assert.equal(
    getElectronPath("downloads", { homeDir: "/home/codex" }),
    path.join("/home/codex", "Downloads"),
  );
});

test("falls back to a durable per-user data directory", () => {
  assert.equal(
    getCodexWebDataDir({ homeDir: "/home/codex" }),
    "/home/codex/.local/share/codex-web",
  );
});
