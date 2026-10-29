#!/bin/sh
set -eu

printf '%s\n' '当前本地 better-sqlite3 原生模块按 Node 25 编译，无法直接在 Node 26 下加载，因此本脚本固定使用 Node 25 启动。'

NODE_BIN_DIR="/home/asym/.nvm/versions/node/v25.0.0/bin"

if [ ! -x "$NODE_BIN_DIR/node" ]; then
  printf '%s\n' "未找到可执行的 Node.js 25.0.0：$NODE_BIN_DIR/node，已退出，不启动服务。" >&2
  exit 1
fi

NODE_VERSION="$("$NODE_BIN_DIR/node" --version)"
case "$NODE_VERSION" in
  v25.*) ;;
  *)
    printf '%s\n' "指定路径的 Node.js 版本为 $NODE_VERSION，需要 Node 25，已退出，不启动服务。" >&2
    exit 1
    ;;
esac

# 在切换 Node 环境前保留 Codex CLI 路径，优先使用显式配置。
if [ -z "${CODEX_CLI_PATH:-}" ]; then
  CODEX_CLI_PATH="$(command -v codex || true)"
  if [ -z "$CODEX_CLI_PATH" ]; then
    printf '%s\n' "Codex CLI not found. Add codex to PATH or set CODEX_CLI_PATH." >&2
    exit 1
  fi
fi
export CODEX_CLI_PATH
export PATH="$NODE_BIN_DIR:$HOME/.local/bin:$PATH"

# Desktop 会探测 GitHub CLI，提前检查可避免运行中因找不到 gh 而退出。
if ! command -v gh >/dev/null 2>&1; then
  printf '%s\n' "GitHub CLI (gh) not found. Install gh in ~/.local/bin or add it to PATH before starting." >&2
  exit 1
fi
if ! gh --version >/dev/null 2>&1; then
  printf '%s\n' "GitHub CLI (gh --version) failed. Fix the gh installation before starting." >&2
  exit 1
fi

# 从任意目录启动时，都以当前脚本所在目录作为项目根目录。
PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$PROJECT_DIR"

exec "$NODE_BIN_DIR/node" src/server/main.js "$@"
