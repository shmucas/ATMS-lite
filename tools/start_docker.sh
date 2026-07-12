#!/usr/bin/env bash
# Start the full ATMS docker-compose stack (emulators, backend, frontend).
# Usage: tools/start_docker.sh [--build] [--no-open] [--extra]
#   --extra   also start emulator-5..10 (the "extra" profile), for a stack
#             of up to 10 virtual intersections instead of the default 4
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop and try again."
  exit 1
fi

COMPOSE_ARGS=()
ARGS=(up -d)
OPEN=1
for arg in "$@"; do
  case "$arg" in
    --build) ARGS+=(--build) ;;
    --no-open) OPEN=0 ;;
    --extra) COMPOSE_ARGS+=(--profile extra) ;;
  esac
done

docker compose "${COMPOSE_ARGS[@]}" "${ARGS[@]}"

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
