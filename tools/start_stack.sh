#!/usr/bin/env bash
# Start the full bench stack: Docker emulators + host backend + host frontend,
# then open the dashboard. This is the hybrid setup from docs/docker.md - the
# physical 2070 is reached by the host backend directly, while emulator-1..4
# run in Docker for the virtual intersections.
# Usage: tools/start_stack.sh [--no-open] [--extra] [--build]
#   --no-open   don't open the dashboard in a browser
#   --extra     also bring up emulator-5..10 (10 virtual intersections instead of 4)
#   --build     force a rebuild of the emulator images before starting
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OPEN=1
COMPOSE_ARGS=()
UP_FLAGS=(-d)
SERVICES=(emulator-1 emulator-2 emulator-3 emulator-4)
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN=0 ;;
    --extra)
      COMPOSE_ARGS+=(--profile extra)
      SERVICES+=(emulator-5 emulator-6 emulator-7 emulator-8 emulator-9 emulator-10)
      ;;
    --build) UP_FLAGS+=(--build) ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop and try again."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is not available (Docker Desktop needs updating). Cannot start the emulators."
  exit 1
fi

echo "Starting Docker emulators..."
docker compose "${COMPOSE_ARGS[@]}" up "${UP_FLAGS[@]}" "${SERVICES[@]}"

"$ROOT/tools/start_backend.sh"
"$ROOT/tools/start_frontend.sh"

if [ "$OPEN" -eq 1 ]; then
  open "http://localhost:5173" 2>/dev/null || true
fi
