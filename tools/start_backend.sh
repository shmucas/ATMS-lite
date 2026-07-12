#!/usr/bin/env bash
# Start the ATMS backend against the bench controller.
# Usage: tools/start_backend.sh [--fg]
#   --fg   run in foreground (default: background, logs to /tmp/atms-backend.log)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VENV_UVICORN="$ROOT/.venv/bin/uvicorn"
if [ ! -x "$VENV_UVICORN" ]; then
  echo "No .venv found. Run: python -m venv .venv && .venv/bin/pip install -r backend/requirements.txt"
  exit 1
fi

if lsof -i :8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is already listening on port 8000. Not starting a second backend."
  exit 1
fi

if [ "${1:-}" = "--fg" ]; then
  exec "$VENV_UVICORN" app.main:app --app-dir backend --port 8000
fi

LOG="/tmp/atms-backend.log"
nohup "$VENV_UVICORN" app.main:app --app-dir backend --port 8000 > "$LOG" 2>&1 &
disown
echo "Backend starting in background (pid $!), logging to $LOG"

for i in $(seq 1 10); do
  if curl -s -o /dev/null http://localhost:8000/docs; then
    echo "Backend is up: http://localhost:8000"
    exit 0
  fi
  sleep 1
done

echo "Backend did not respond after 10s, check $LOG"
exit 1
