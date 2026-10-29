#!/bin/sh
set -eu

# 支持 ./start.sh 9000；不传参数时使用 8214，原有选项继续透传。
if [ "$#" -eq 0 ]; then
  set -- --port 8214
else
  case "$1" in
    -*) ;;
    *)
      LISTEN_PORT="$1"
      shift
      set -- --port "$LISTEN_PORT" "$@"
      ;;
  esac
fi

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

# 固定使用 Node 25 环境中的 Codex，避免启动环境选择到其他版本。
CODEX_CLI_PATH="$NODE_BIN_DIR/codex"
export CODEX_CLI_PATH
export PATH="$NODE_BIN_DIR:$HOME/.local/bin:$PATH"

if [ ! -x "$CODEX_CLI_PATH" ]; then
  printf '%s\n' "Codex CLI not found or not executable: $CODEX_CLI_PATH. Install Codex in the Node 25 environment before starting." >&2
  exit 1
fi
if ! "$CODEX_CLI_PATH" --version >/dev/null 2>&1; then
  printf '%s\n' "Codex CLI failed to run in the Node 25 environment: $CODEX_CLI_PATH. Fix the installation before starting." >&2
  exit 1
fi

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
