#!/usr/bin/env bash
# Stop everything tools/start_stack.sh (or tools/start_docker.sh) started:
# Docker containers (emulators, and the containerized backend/frontend if
# that's the mode in use), plus the host backend (port 8000) and host
# frontend (port 5173) from the bench workflow.
# Usage: tools/stop_stack.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "Stopping Docker containers..."
  docker compose --profile extra down
else
  echo "Docker compose is not available or the daemon is not running, skipping docker compose down."
fi

for port in 8000 5173; do
  pid="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    echo "Stopping process on port $port (pid $pid)"
    kill $pid
  fi
done

echo "Stack stopped."
