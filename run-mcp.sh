#!/usr/bin/env bash
set -euo pipefail
export PATH="/Users/ricardo/.nvm/versions/node/v22.21.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PTY_TERMINAL_API_BASE="${PTY_TERMINAL_API_BASE:-http://127.0.0.1:8787}"
ROOT="/Users/ricardo/code/courtify/zhongxin/pty-mcp-terminal"
SERVER_DIR="$ROOT/apps/server"
LOG_FILE="/tmp/pty-terminal-server.log"

if ! curl -fsS "$PTY_TERMINAL_API_BASE/api/sessions" >/dev/null 2>&1; then
  cd "$ROOT"
  nohup /Users/ricardo/.nvm/versions/node/v22.21.1/bin/node apps/server/dist/index.js >>"$LOG_FILE" 2>&1 &

  for _ in {1..50}; do
    if curl -fsS "$PTY_TERMINAL_API_BASE/api/sessions" >/dev/null 2>&1; then
      break
    fi
    sleep 0.1
  done
fi

cd "$SERVER_DIR"
exec /Users/ricardo/.nvm/versions/node/v22.21.1/bin/node dist/mcp.js 2>>/tmp/pty-terminal-mcp.stderr.log
