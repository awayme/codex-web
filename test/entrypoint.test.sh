#!/usr/bin/env bash
set -euo pipefail

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

mkdir -p "$test_root/secrets"
printf '%s\n' \
  'Host alpha' \
  '  HostName alpha.example.test' \
  >"$test_root/secrets/config"
printf '%s\n' 'private-key-placeholder' >"$test_root/secrets/id_ed25519"

HOME="$test_root/home" \
CODEX_SSH_SOURCE_DIR="$test_root/secrets" \
CODEX_WEB_DATA_DIR="$test_root/data" \
CODEX_WEB_PREPARE_ONLY=1 \
  bash docker/entrypoint.sh

test "$(stat -c '%a' "$test_root/home/.ssh")" = "700"
test "$(stat -c '%a' "$test_root/home/.ssh/config")" = "600"
test "$(stat -c '%a' "$test_root/home/.ssh/id_ed25519")" = "600"
test -d "$test_root/data/session"
