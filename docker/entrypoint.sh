#!/usr/bin/env bash
set -euo pipefail

data_dir="${CODEX_WEB_DATA_DIR:-/data}"
ssh_source_dir="${CODEX_SSH_SOURCE_DIR:-/run/secrets/codex-ssh}"
ssh_target_dir="${HOME}/.ssh"

install -d -m 700 \
  "$data_dir" \
  "$data_dir/cache" \
  "$data_dir/crash-dumps" \
  "$data_dir/logs" \
  "$data_dir/session" \
  "$ssh_target_dir"

if [[ -d "$ssh_source_dir" ]]; then
  shopt -s nullglob
  ssh_source_files=("$ssh_source_dir"/*)
  shopt -u nullglob

  for source_file in "${ssh_source_files[@]}"; do
    if [[ -f "$source_file" ]]; then
      install -m 600 "$source_file" "$ssh_target_dir/$(basename "$source_file")"
    fi
  done
fi

if [[ "${CODEX_WEB_PREPARE_ONLY:-0}" == "1" ]]; then
  exit 0
fi

exec node /app/src/server/main.js \
  --host "${CODEX_WEB_HOST:-0.0.0.0}" \
  --port "${PORT:-8080}" \
  "$@"
