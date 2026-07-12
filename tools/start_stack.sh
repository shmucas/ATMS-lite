#!/usr/bin/env bash
# Start the ATMS backend and frontend together, then open the dashboard.
# Usage: tools/start_stack.sh [--no-open]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT/tools/start_backend.sh"
"$ROOT/tools/start_frontend.sh"

if [ "${1:-}" != "--no-open" ]; then
  open "http://localhost:5173" 2>/dev/null || true
fi
