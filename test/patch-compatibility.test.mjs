import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const enableLinuxRemoteControlKeys = path.join(
  repositoryRoot,
  "scripts",
  "enable_linux_remote_control_keys.mjs",
);
const removeUpstreamCsp = path.join(
  repositoryRoot,
  "scripts",
  "remove_upstream_csp.mjs",
);
const upstreamGuard =
  "if(process.platform!==`darwin`&&process.platform!==`win32`)throw Error(`Remote control device keys are only available on macOS and Windows`)";
const hostedGuard =
  "if(process.platform!==`darwin`&&process.platform!==`win32`&&process.env.CODEX_WEB_SOFTWARE_DEVICE_KEYS!==`1`)throw Error(`Remote control device keys are only available on macOS and Windows`)";

test("ports the current macOS/Windows device-key guard to guarded Linux", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-web-patch-test-"));
  const buildDirectory = path.join(root, ".vite", "build");
  const bundlePath = path.join(buildDirectory, "main-current.js");

  try {
    await fs.mkdir(buildDirectory, { recursive: true });
    await fs.writeFile(bundlePath, `before;${upstreamGuard};after\n`);

    const result = spawnSync(
      process.execPath,
      [enableLinuxRemoteControlKeys, root],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      await fs.readFile(bundlePath, "utf8"),
      `before;${hostedGuard};after\n`,
    );
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
});

test("fails closed when the upstream device-key guard changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-web-patch-test-"));
  const buildDirectory = path.join(root, ".vite", "build");

  try {
    await fs.mkdir(buildDirectory, { recursive: true });
    await fs.writeFile(
      path.join(buildDirectory, "main-current.js"),
      "an upstream guard that no longer matches\n",
    );

    const result = spawnSync(
      process.execPath,
      [enableLinuxRemoteControlKeys, root],
      { encoding: "utf8" },
    );

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Expected one macOS\/Windows remote-control device-key guard, found 0/u,
    );
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
});

test("removes exactly one upstream CSP meta tag", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-web-csp-test-"));
  const webviewDirectory = path.join(root, "webview");
  const indexPath = path.join(webviewDirectory, "index.html");

  try {
    await fs.mkdir(webviewDirectory, { recursive: true });
    await fs.writeFile(
      indexPath,
      [
        "<html>",
        "<head>",
        '  <meta http-equiv="Content-Security-Policy" content="default-src \'none\'">',
        "</head>",
        "</html>",
        "",
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [removeUpstreamCsp, root], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const updated = await fs.readFile(indexPath, "utf8");
    assert.doesNotMatch(updated, /Content-Security-Policy/u);
    assert.match(updated, /<\/head>/u);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
});

test("fails closed when the upstream CSP tag changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-web-csp-test-"));
  const webviewDirectory = path.join(root, "webview");

  try {
    await fs.mkdir(webviewDirectory, { recursive: true });
    await fs.writeFile(
      path.join(webviewDirectory, "index.html"),
      "<html><head></head></html>\n",
    );

    const result = spawnSync(process.execPath, [removeUpstreamCsp, root], {
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Expected one upstream Content-Security-Policy meta tag, found 0/u,
    );
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
});
