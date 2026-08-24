import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const updater = path.join(
  repositoryRoot,
  "scripts",
  "update_upstream_versions.py",
);

test("updates pinned desktop and CLI versions from verified metadata shapes", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "codex-web-update-test-"),
  );
  const dockerfile = path.join(root, "Dockerfile");
  const remoteTestDockerfile = path.join(root, "Dockerfile.remote-test");
  const appcast = path.join(root, "appcast.xml");
  const npmMetadata = path.join(root, "npm.json");
  const githubOutput = path.join(root, "github-output");

  try {
    await fs.writeFile(
      dockerfile,
      ["ARG CODEX_APP_VERSION=26.1.100", "ARG CODEX_VERSION=0.1.0", ""].join(
        "\n",
      ),
    );
    await fs.writeFile(remoteTestDockerfile, "ARG CODEX_VERSION=0.0.9\n");
    await fs.writeFile(
      appcast,
      `<?xml version="1.0"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <sparkle:version>41</sparkle:version>
      <sparkle:shortVersionString>26.2.200</sparkle:shortVersionString>
    </item>
    <item>
      <sparkle:version>42</sparkle:version>
      <sparkle:shortVersionString>26.2.201</sparkle:shortVersionString>
    </item>
  </channel>
</rss>
`,
    );
    await fs.writeFile(npmMetadata, '{"version":"0.2.0"}\n');

    const result = spawnSync(
      "python3",
      [
        updater,
        "--dockerfile",
        dockerfile,
        "--appcast-file",
        appcast,
        "--npm-metadata-file",
        npmMetadata,
        "--github-output",
        githubOutput,
        "--write",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      app_changed: true,
      app_version: "26.2.201",
      changed: true,
      cli_changed: true,
      cli_version: "0.2.0",
      current_app_version: "26.1.100",
      current_cli_version: "0.1.0",
      current_remote_test_cli_version: "0.0.9",
      pins_changed: true,
    });
    assert.equal(
      await fs.readFile(dockerfile, "utf8"),
      ["ARG CODEX_APP_VERSION=26.2.201", "ARG CODEX_VERSION=0.2.0", ""].join(
        "\n",
      ),
    );
    assert.match(await fs.readFile(githubOutput, "utf8"), /changed=true/);
    assert.equal(
      await fs.readFile(remoteTestDockerfile, "utf8"),
      "ARG CODEX_VERSION=0.2.0\n",
    );

    const unchanged = spawnSync(
      "python3",
      [
        updater,
        "--dockerfile",
        dockerfile,
        "--appcast-file",
        appcast,
        "--npm-metadata-file",
        npmMetadata,
      ],
      { encoding: "utf8" },
    );
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.equal(JSON.parse(unchanged.stdout).changed, false);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
});

test("repairs a secondary CLI pin even when the upstream versions are unchanged", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "codex-web-pin-sync-test-"),
  );
  const dockerfile = path.join(root, "Dockerfile");
  const remoteTestDockerfile = path.join(root, "Dockerfile.remote-test");
  const appcast = path.join(root, "appcast.xml");
  const npmMetadata = path.join(root, "npm.json");

  try {
    await fs.writeFile(
      dockerfile,
      ["ARG CODEX_APP_VERSION=26.2.201", "ARG CODEX_VERSION=0.2.0", ""].join(
        "\n",
      ),
    );
    await fs.writeFile(remoteTestDockerfile, "ARG CODEX_VERSION=0.1.0\n");
    await fs.writeFile(
      appcast,
      `<?xml version="1.0"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <sparkle:version>42</sparkle:version>
      <sparkle:shortVersionString>26.2.201</sparkle:shortVersionString>
    </item>
  </channel>
</rss>
`,
    );
    await fs.writeFile(npmMetadata, '{"version":"0.2.0"}\n');

    const result = spawnSync(
      "python3",
      [
        updater,
        "--dockerfile",
        dockerfile,
        "--appcast-file",
        appcast,
        "--npm-metadata-file",
        npmMetadata,
        "--write",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      {
        changed: JSON.parse(result.stdout).changed,
        pinsChanged: JSON.parse(result.stdout).pins_changed,
      },
      { changed: true, pinsChanged: true },
    );
    assert.equal(
      await fs.readFile(remoteTestDockerfile, "utf8"),
      "ARG CODEX_VERSION=0.2.0\n",
    );
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
});

test("local preparation reads the authoritative desktop pin without network access", () => {
  const result = spawnSync(
    "python3",
    [
      updater,
      "--dockerfile",
      path.join(repositoryRoot, "Dockerfile"),
      "--print-current-app-version",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^26\.[0-9.]+\n$/);
});

test("candidate validation passes detected pins explicitly and does not use Issues", async () => {
  const workflow = await fs.readFile(
    path.join(repositoryRoot, ".github", "workflows", "upstream-update.yml"),
    "utf8",
  );
  const candidateBuild = await fs.readFile(
    path.join(repositoryRoot, "cloudbuild.upstream-candidate.yaml"),
    "utf8",
  );

  assert.match(workflow, /_CODEX_APP_VERSION=\$\{APP_VERSION\}/);
  assert.match(workflow, /_CODEX_VERSION=\$\{CLI_VERSION\}/);
  assert.match(candidateBuild, /CODEX_APP_VERSION=\$\{_CODEX_APP_VERSION\}/);
  assert.match(candidateBuild, /CODEX_VERSION=\$\{_CODEX_VERSION\}/);
  assert.doesNotMatch(workflow, /gh issue|issues: write/);
  assert.match(workflow, /separate manual rollback action/);
});
