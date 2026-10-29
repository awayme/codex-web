#!/usr/bin/env bash
set -euo pipefail

public_key_file="${CODEX_TEST_PUBLIC_KEY_FILE:-/run/secrets/codex-test/id_ed25519.pub}"
remote_marker="${REMOTE_MARKER:-unknown}"

if [[ ! -f "$public_key_file" ]]; then
  echo "Missing test SSH public key: $public_key_file" >&2
  exit 1
fi

install -d -o codex -g codex -m 700 /home/codex/.ssh
install -o codex -g codex -m 600 \
  "$public_key_file" \
  /home/codex/.ssh/authorized_keys

printf '%s\n' "$remote_marker" >/workspace/REMOTE_HOST
chown codex:codex /workspace/REMOTE_HOST

ssh-keygen -A

exec /usr/sbin/sshd -D -e \
  -o AllowUsers=codex \
  -o AuthorizedKeysFile=.ssh/authorized_keys \
  -o KbdInteractiveAuthentication=no \
  -o PasswordAuthentication=no \
  -o PermitRootLogin=no \
  -o UsePAM=no
