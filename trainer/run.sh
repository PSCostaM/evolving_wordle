#!/usr/bin/env bash
#
# Run the FastAPI trainer standalone — no pnpm, no manual venv activation.
#
#   cd trainer && ./run.sh
#
# Uses the local .venv directly. Override host/port via env:
#   PORT=8001 ./run.sh
#   HOST=127.0.0.1 ./run.sh
# Disable process-parallel population scoring (fall back to serial):
#   WORDLE_EVAL_WORKERS=1 ./run.sh
#
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  echo "No .venv found in $(pwd)." >&2
  echo "Run ./setup.sh once to create it, then ./run.sh again." >&2
  exit 1
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

echo "Starting Wordle trainer API on http://${HOST}:${PORT} (reload on)…"
exec .venv/bin/python -m uvicorn wordle_evolution.server.main:app \
  --reload --host "${HOST}" --port "${PORT}"
