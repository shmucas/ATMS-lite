#!/usr/bin/env bash
# Start the ATMS frontend dev server.
# Usage: tools/start_frontend.sh [--fg]
#   --fg   run in foreground (default: background, logs to /tmp/atms-frontend.log)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "No frontend/node_modules found. Run: npm install --prefix frontend"
  exit 1
fi

if lsof -i :5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is already listening on port 5173. Not starting a second frontend."
  exit 1
fi

if [ "${1:-}" = "--fg" ]; then
  exec npm run dev --prefix frontend
fi

LOG="/tmp/atms-frontend.log"
nohup npm run dev --prefix frontend > "$LOG" 2>&1 &
disown
echo "Frontend starting in background (pid $!), logging to $LOG"

for i in $(seq 1 10); do
  if curl -s -o /dev/null http://localhost:5173; then
    echo "Frontend is up: http://localhost:5173"
    exit 0
  fi
  sleep 1
done

echo "Frontend did not respond after 10s, check $LOG"
exit 1
