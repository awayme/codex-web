# Codex Web contributor instructions

## Workspace

- Clone or pull this repository into a folder under the machine's `git`
  directory.
- Never commit SSH private keys, Codex credentials, Google Cloud credentials,
  or populated secret directories.
- Subagents may be dispatched when parallel work is useful.

## Project goal

This fork packages the upstream Codex desktop web client as a Docker container.
It must preserve the desktop application's native multi-host connection model:
each configured SSH host is a separate Codex app-server connection managed from
**Settings > Connections**.

Do not replace that flow with a codex-web-specific remote-host protocol.
Remote app-server traffic must continue through SSH; do not expose app-server
directly on a public network port.

## Container contract

- The production image is built from `Dockerfile`.
- The server listens on port `8080`.
- `/data` contains persistent Electron and connection state.
- SSH configuration and key material are mounted read-only at
  `/run/secrets/codex-ssh`.
- The entrypoint copies readable secret files to the runtime user's
  `~/.ssh` with mode `0600`.
- The runtime user is the non-root `codex` user with UID `10001`.
- Health probes are `/__backend/healthz` and `/__backend/readyz`.

Each real remote host must accept key-based SSH and have the official
installer-managed standalone Codex installation available on the remote login
shell's `PATH`:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex app-server daemon version
```

## Required validation

Before publishing or deploying container changes, run:

```bash
npm ci
npm test
docker build --tag codex-web:local .
npm run test:docker:multihost
docker run --rm --entrypoint npm codex-web:local audit --omit=dev --json
```

The multi-host test creates two disposable SSH hosts and verifies that the
production container can independently authenticate to both and start a real
Codex app-server daemon on each.

For a quick manual smoke test:

```bash
docker run --rm \
  --name codex-web \
  --publish 127.0.0.1:8080:8080 \
  --volume codex-web-data:/data \
  codex-web:local
```

Then open <http://127.0.0.1:8080>.

## Current handoff

The image has been built and tested locally as `codex-web:local`. Unit tests,
entrypoint tests, HTTP health checks, the rendered Codex page, non-root runtime,
and the disposable two-host Codex daemon integration test passed. The final
runtime dependency audit reported zero vulnerabilities.

No GCP image upload or deployment has been performed yet. On another machine,
rebuild and rerun the required validation above before preparing the GCP
deployment.
