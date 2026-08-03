import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

const installerFlags = [
  "--ssh-key",
  "--paste-key",
  "--key-save-path",
  "--ssh-user",
  "--ssh-host",
  "--ssh-port",
  "--host-alias",
  "--listen-address",
  "--web-port",
  "--domain",
  "--public-ip",
  "--web-username",
  "--http-port",
  "--https-port",
  "--container-name",
  "--proxy-container",
  "--proxy-network",
  "--data-volume",
  "--ssh-volume",
  "--caddyfile-volume",
  "--caddy-data-volume",
  "--caddy-config-volume",
  "--caddy-image",
  "--image",
  "--internal-tls",
  "--skip-build",
  "--yes",
  "--help",
];

test("VM installer help and installation guide cover every supported flag", async () => {
  const repositoryRoot = new URL("..", import.meta.url);
  const installerPath = new URL("../scripts/install-vm.sh", import.meta.url)
    .pathname;
  const [{ stdout }, installGuide] = await Promise.all([
    execFileAsync(installerPath, ["--help"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
    fs.readFile(new URL("../INSTALL.md", import.meta.url), "utf8"),
  ]);

  for (const flag of installerFlags) {
    assert.match(stdout, new RegExp(`(^|\\s)${flag}(\\s|$)`, "mu"));
    assert.ok(
      installGuide.includes(flag),
      `${flag} is missing from INSTALL.md`,
    );
  }
});

test("VM installer uses cookie sessions for HTTP and WebSocket authentication", async () => {
  const installer = await fs.readFile(
    new URL("../scripts/install-vm.sh", import.meta.url),
    "utf8",
  );

  assert.match(installer, /handle \/__codex_web_login/u);
  assert.match(installer, /handle \/__codex_web_logout/u);
  assert.match(installer, /Secure; HttpOnly; SameSite=Strict/u);
  assert.match(
    installer,
    /@public_pwa path \/manifest\.json \/assets\/pwa-icon-512\.png/u,
  );
  assert.match(installer, /\[\[ "\$unauthenticated_status" == "303" \]\]/u);
});
