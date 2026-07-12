#!/usr/bin/env bash
# Start the full ATMS docker-compose stack (emulators, backend, frontend).
# Usage: tools/start_docker.sh [--build] [--no-open]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop and try again."
  exit 1
fi

ARGS=(up -d)
OPEN=1
for arg in "$@"; do
  case "$arg" in
    --build) ARGS+=(--build) ;;
    --no-open) OPEN=0 ;;
  esac
done

docker compose "${ARGS[@]}"

echo "Waiting for backend on http://localhost:8000 ..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://localhost:8000/docs; then
    echo "Backend is up: http://localhost:8000"
    break
  fi
  sleep 1
done

echo "Frontend: http://localhost:8080"

if [ "$OPEN" -eq 1 ]; then
  open "http://localhost:8080" 2>/dev/null || true
fi
