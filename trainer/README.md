# wordle_evolution — Python GA trainer

The training brain of the Wordle Evolution Lab. It evolves the 12 heuristic
weights of a Wordle-playing bot with a genetic algorithm, exposes a FastAPI +
WebSocket backend for the dashboard, and saves reproducible JSON artifacts.

The TypeScript dashboard lives in `../apps/web`. This package is the **source of
truth for evolution**; every JSON value it emits uses **camelCase** field names
and **camelCase feature-weight keys** so it lines up 1:1 with the frontend types.

## Quick start (standalone)

This directory runs on its own — no pnpm, no manual venv activation. From `trainer/`:

```bash
./setup.sh     # one-time: creates .venv and installs the package
./run.sh       # starts the FastAPI + WebSocket API on http://localhost:8000
```

`run.sh` uses `.venv/bin/python` directly. Handy overrides:

```bash
PORT=8001 ./run.sh              # different port
HOST=127.0.0.1 ./run.sh         # bind localhost only
WORDLE_EVAL_WORKERS=1 ./run.sh  # serial population scoring (default: cores-1 processes)
```

Then start the dashboard separately in another terminal: `pnpm dev:web` (from the
repo root) and open http://localhost:5173. The manual steps below are equivalent.

## Install

Requires **Python 3.12+**.

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
```

Runtime deps: `fastapi`, `uvicorn[standard]`, `pydantic`, `numpy`, `rich`,
`orjson`, `python-multipart`. Dev extra adds `pytest`, `pytest-cov`.

## Run

```bash
# Tests
pytest                      # or: pytest --cov=wordle_evolution

# API server (dashboard connects here)
python -m uvicorn wordle_evolution.server.main:app --reload --port 8000

# Offline training → saves artifacts (this is what `pnpm train` runs)
python -m wordle_evolution.experiments.run_experiment
python -m wordle_evolution.experiments.run_experiment --generations 100 --population 80 --sample 150 --seed codebullet-wordle
python -m wordle_evolution.experiments.run_experiment --no-entropy      # ablation

# Compare two saved runs
python -m wordle_evolution.experiments.compare_runs <run_a_id> <run_b_id>
```

## Package layout

```
wordle/       scoring (two-pass repeated-letter feedback), candidate_filter,
              words (loads data/*.txt), types (FEATURE_ORDER + camelCase map)
features/     the 12 heuristic features, entropy + frequency helpers,
              extract_features(), choose_guess() (explainable GuessDecision)
ga/           chromosome (+ seeded species), population, selection (tournament),
              crossover (uniform + blend), mutation (gaussian + large kick),
              evolution (Evolution loop, diversity, elitism), fitness
baselines/    random / frequency / entropy / candidate reference bots
server/        FastAPI app (main), pydantic schemas, training_manager, websocket
io/           artifacts (save/load latest + timestamped runs), import_words
experiments/  run_experiment (CLI, saves artifacts), compare_runs
utils/        seed (hashlib-derived deterministic RNG), timing
```

## Determinism

All randomness is derived from a **string seed** via `utils/seed.py`
(`hashlib`-based, not Python's salted `hash()`), keyed per `(purpose,
generation)`. The same `seed` + config reproduces a run exactly — covered by
`tests/test_ga.py`.

## Artifact schema

`run_experiment` (and `POST /api/train/offline`) write to `artifacts/latest/`
and a timestamped `artifacts/runs/<YYYY-MM-DD_HHMMSS_slug>/`:

| File | Shape |
|---|---|
| `champion.json` | `{ chromosome:{id,weights,mutationRate,generationBorn,species}, fitness, stats, nickname }` |
| `generation_history.json` | `[{ generation, evaluations, bestFitness, avgFitness, medianFitness, winRate, avgGuesses, diversityScore, championId, championNickname, elapsedMs }]` |
| `replay_samples.json` | `[ReplayMatch]` — champion games, each turn carries an explainable `decision` |
| `baseline_comparison.json` | `[{ key, name, winRate, avgGuesses, failures, games, histogram[7], fitness }]` |
| `experiment_summary.json` | `{ runId, seed, config, generations, timestamp, durationMs, finalChampionId, bestFitness }` |

`histogram` is length 7: `[failures, solved_in_1, …, solved_in_6]`.

## REST + WebSocket

REST: `GET /health` · `GET /api/config/defaults` · `GET /api/artifacts/latest` ·
`GET /api/artifacts/runs` · `GET /api/artifacts/runs/{id}` ·
`POST /api/train/offline` · `POST /api/champion/replay` ·
`POST /api/baselines/compare` · `POST /api/words/validate` ·
`POST /api/words/import`.

WebSocket `WS /ws/train`: the client sends `{ "type": "start", "config": {…} }`
(and `pause`/`resume`/`stop`/`reset`). The server streams `training_started`,
`generation_complete` (with snake_case summary fields plus a full camelCase
`report`, `champion`, and `sample_replay`), `training_paused`,
`training_resumed`, `training_complete`, and `error`. The config accepts the
frontend's full camelCase `EvolutionConfig` and ignores unknown extra fields.

## Adding a new heuristic feature

1. Add the snake_case name to `FEATURE_ORDER` and its camelCase mapping in
   `wordle/types.py` (`SNAKE_TO_CAMEL`).
2. Compute it inside `extract_features()` in `features/feature_extractor.py`
   (return a **non-negative magnitude**; the evolved weight carries the sign).
3. Add a test in `tests/test_features.py`.
4. Mirror the camelCase name + a label in the frontend
   (`apps/web/src/engine/types.ts → FEATURE_META`) so the dashboard renders it.

Keep the Python and TypeScript `FEATURE_ORDER` lists in the **same order** so
serialized weight vectors stay aligned.

## Tuning fitness

Edit `FitnessConfig` in `ga/fitness.py`:

```
fitness = win_rate*10000 - avg_guesses*800 - failure_rate*5000
        + solved_in_3_or_less_rate*1200 - avg_remaining_after_guess_2*5
        + hard_word_success_rate*1500
```

"Hard words" are defined by `is_hard_word()` (answers with a repeated letter).
