#!/usr/bin/env bash
#
# One-time setup for the standalone trainer: create .venv and install the
# package (with dev extras). Safe to re-run — it reuses an existing .venv.
#
#   cd trainer && ./setup.sh
#
# Pick a specific interpreter with PYTHON=... (defaults to python3):
#   PYTHON=python3.12 ./setup.sh
#
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3}"

if [ ! -x .venv/bin/python ]; then
  echo "Creating virtualenv with ${PYTHON}…"
  "${PYTHON}" -m venv .venv
fi

echo "Installing wordle_evolution (editable, with dev extras)…"
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -e ".[dev]"

echo
echo "✓ Trainer ready. Start it with:  ./run.sh"
