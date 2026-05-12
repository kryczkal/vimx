#!/usr/bin/env bash
# scripts/dev-chrome.sh — launch a dedicated chromium for this worktree.
#
# Reads CDP_PORT from ./.mcp.json (written by .cwt-hooks/post-new).
# Tracks PID at ./.cwt-state/chrome.pid so .cwt-hooks/pre-remove can clean up.
# Refuses to launch if the port is already in use.
#
# Run from the worktree root.

set -euo pipefail

[[ -f .mcp.json ]] || { echo "no .mcp.json in $(pwd) — run 'cwt new' first or you're in the wrong dir" >&2; exit 1; }

port=$(jq -r '.mcpServers.webpilot.env.CDP_PORT // empty' .mcp.json 2>/dev/null || true)
[[ -z "$port" ]] && { echo "could not read CDP_PORT from .mcp.json" >&2; exit 1; }

# Derive the worktree-specific name from the directory (works because cwt
# always creates worktrees as <repo>.<name>).
wt_dir=$(basename "$(pwd)")
profile="/tmp/chrome-cwt-$wt_dir"

mkdir -p .cwt-state
pid_file=".cwt-state/chrome.pid"

if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  echo "chrome already running (pid=$(cat "$pid_file"), port=$port, profile=$profile)"
  exit 0
fi

if command -v ss >/dev/null 2>&1 && ss -ltn "sport = :$port" 2>/dev/null | grep -q ":$port"; then
  echo "port $port already in use by another process" >&2
  exit 1
fi

nohup chromium \
  --remote-debugging-port="$port" \
  --user-data-dir="$profile" \
  --no-first-run \
  --no-default-browser-check \
  >/dev/null 2>&1 &
echo $! > "$pid_file"
sleep 0.5
echo "chrome launched (pid=$(cat "$pid_file"), port=$port, profile=$profile)"
