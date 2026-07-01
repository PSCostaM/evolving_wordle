# 🧬 Wordle Evolution Lab — hybrid Python + TypeScript

**Watch a tiny population of dumb Wordle bots evolve into terrifyingly good guessers.**

A CodeBullet-style genetic-algorithm playground. The AI is **not** a neural network — it's a heuristic Wordle player whose 12 numeric weights are evolved by a genetic algorithm. A **Python trainer** runs the real evolution and streams every generation, live, to a **TypeScript/React dashboard** over a WebSocket.

```
wordle-evolution-ai/
├─ apps/web/      → Vite + React + TypeScript dashboard (the fun, interactive part)
└─ trainer/       → Python 3.12 GA trainer + FastAPI backend (the serious training)
```

---

## Architecture

A **pnpm monorepo** with a clean split of responsibilities:

| Part | Role |
|---|---|
| **`trainer/`** (Python 3.12) | The training brain. Runs the genetic algorithm and exposes a **FastAPI + WebSocket** backend for training, replay, baselines, artifacts, and word import. |
| **`apps/web/`** (Vite + React + TS) | The dashboard. Streams live generations over WebSocket and renders the boards, charts, tables, and explainability panels. |
| **Browser engine** (`apps/web/src/engine` + `src/ga`) | A self-contained TypeScript GA that powers **Local demo mode** (run everything client-side, no backend) and the **replay engine** that animates any champion's weights offline. |

Runs are saved as reproducible **JSON artifacts** you can reload and replay later, and the app is fully usable with or without Python running.

### Why Python for training?
Evolutionary search is CPU-bound number crunching — thousands of simulated Wordle games per generation. Python + NumPy is the natural home for that: easy to profile, parallelize, and script into reproducible experiments (`pnpm train`), and it keeps heavy work off the UI thread entirely.

### Why TypeScript for visualization?
The dashboard is where the joy is: animated Wordle boards, evolution charts, a sortable population table, weight visualizers, and an explainability panel. React + Vite + Tailwind + Recharts make that fast to build and delightful to use — and it runs anywhere, instantly.

---

## Three ways to use it

The top bar has a **mode selector**:

- **🐍 Live (Python)** — start/pause/resume/stop training on the backend and watch generations stream in.
- **🧪 Local demo** — run the entire GA in your browser. No backend required. Great offline.
- **📦 Artifact replay** — load a saved run (from the API or an uploaded JSON file) and explore the champion, history, and baselines statically.

If the backend is offline while you're in Live mode, you get a **"Python backend offline"** banner with the exact command to start it and a one-click switch to Local demo.

---

## Install everything

Prereqs: **Node 18+**, **pnpm** (`corepack enable`), **Python 3.12+**.

### macOS / Linux
```bash
pnpm install

cd trainer
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd ..

pnpm dev        # runs the web app + Python API together
```

### Windows (PowerShell)
```powershell
pnpm install

cd trainer
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
cd ..

pnpm dev
```

`pnpm dev` starts **both** the Vite dev server (http://localhost:5173) and the FastAPI backend (http://localhost:8000) via `concurrently`. Open the printed web URL, make sure the top bar says **backend online**, pick **Live (Python)**, and hit **Start**.

---

## Run just one half

**Frontend only** (uses Local demo mode — no Python needed):
```bash
pnpm dev:web
```

**Python trainer / API only:**
```bash
cd trainer
source .venv/bin/activate            # Windows: .venv\Scripts\Activate.ps1
python -m uvicorn wordle_evolution.server.main:app --reload --port 8000
# or, from the repo root:
pnpm dev:trainer
```

**Full live mode:** run both (`pnpm dev`), or run the two commands above in separate terminals.

---

## Run the tests

```bash
pnpm test          # both suites
pnpm test:web      # Vitest: Wordle scoring, repeated letters, filtering, GA, determinism
pnpm test:trainer  # pytest: scoring, filtering, features, GA, fitness, determinism
```

The frontend `.env` sets where the app looks for the backend:
```
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_BASE_URL=ws://localhost:8000
```

---

## Train offline and load artifacts

Run a full training from the command line and save JSON artifacts:
```bash
pnpm train
# equivalently:
cd trainer && python -m wordle_evolution.experiments.run_experiment
# tune it:
python -m wordle_evolution.experiments.run_experiment --generations 100 --population 80 --sample 150 --seed codebullet-wordle
```

Artifacts are written to:
```
trainer/artifacts/
  latest/                     # always the most recent run
    champion.json
    generation_history.json
    replay_samples.json
    baseline_comparison.json
    experiment_summary.json
  runs/2026-06-30_<slug>/     # timestamped snapshot of every run
```

Then in the dashboard: **📦 Artifact replay → ⬇ Load latest** (from the API), or **📁 Load run from file** (drop in any of the saved bundles). You can also `POST /api/train/offline` to kick a run from the backend.

---

## How the genetic algorithm works

Every individual (a **chromosome**) is a bag of 12 numeric weights, a self-adapting mutation rate, and some bookkeeping. To play one game a bot:

1. Turns **every candidate guess** into a feature vector for the current game state.
2. Scores each guess as a weighted sum of **normalized** features and picks the argmax.
3. Reads the Wordle feedback (🟩 correct / 🟨 present / ⬛ absent — computed with a correct **two-pass** repeated-letter algorithm).
4. Filters the possible answers down to those still consistent with the feedback.
5. Repeats until it wins or burns all 6 guesses.

The GA then: seeds a population (hand-designed **species** + random fill), evaluates everyone on the **same** sampled answers (common random numbers → fair comparison), keeps the **elites**, and breeds the rest with **tournament selection** + **uniform/blend crossover** + **Gaussian (and occasional large) mutation**, with weights clamped to `[-10, 10]` and a **cosine-distance diversity** score to fight premature convergence. Everything flows through a seed-derived RNG, so a seed reproduces a run exactly.

**The 12 heuristic weights** (each feature is a non-negative magnitude; the evolved weight carries the sign):

| Weight | Rewards |
|---|---|
| `candidateBonus` | Guessing a word that's still a possible answer |
| `entropyScore` | Splitting remaining candidates into many even feedback buckets |
| `expectedRemainingPenalty` | (penalizes) how many candidates a guess leaves on average |
| `letterFrequencyScore` | Common letters among remaining candidates |
| `positionalFrequencyScore` | Letters in their most common position |
| `uniqueLetterBonus` | Distinct letters, especially early |
| `duplicateLetterPenalty` | (penalizes) repeated letters when implausible |
| `vowelCoverageScore` | Discovering unknown vowels early |
| `knownGreenBonus` | Keeping confirmed greens in place |
| `knownYellowBonus` | Reusing known-present letters in new spots |
| `knownAbsentPenalty` | (penalizes) reusing known-absent letters |
| `endgameCandidatePressure` | Taking the shot when few candidates remain |

**Fitness** (configurable, easy to tune in `trainer/.../ga/fitness.py`):
```
fitness = winRate*10000 − avgGuesses*800 − failureRate*5000
        + solvedIn3OrLessRate*1200 − avgRemainingAfterGuess2*5
        + hardWordSuccessRate*1500
```

---

## How the WebSocket stream works

The dashboard connects to `ws://localhost:8000/ws/train`, sends a training config, and receives a stream of events.

**Client → server:** `{ "type": "start", "config": {…} }`, `{"type":"pause"}`, `{"type":"resume"}`, `{"type":"stop"}`, `{"type":"reset"}`.

**Server → client:**
```jsonc
{ "type": "training_started" }
{ "type": "generation_complete",
  "generation": 12,
  "best_fitness": 9123.5, "average_fitness": 7210.2,
  "best_win_rate": 0.98, "best_average_guesses": 3.84, "diversity": 0.42,
  "champion": { "id": "…", "weights": { /* camelCase */ } },
  "report":  { /* full camelCase GenerationReport for the UI */ },
  "sample_replay": { /* a ReplayMatch of the champion */ } }
{ "type": "training_paused" }
{ "type": "training_resumed" }
{ "type": "training_complete", "reason": "fixed" }
{ "type": "error", "message": "…" }
```

Every JSON value crossing to the frontend uses **camelCase** field names and **camelCase feature-weight keys**, so the Python schemas line up 1:1 with the TypeScript types in `apps/web/src/api/types.ts`.

### REST endpoints (see `trainer/README.md`)
`GET /health` · `GET /api/config/defaults` · `GET /api/artifacts/latest` · `GET /api/artifacts/runs` · `GET /api/artifacts/runs/{id}` · `POST /api/train/offline` · `POST /api/champion/replay` · `POST /api/baselines/compare` · `POST /api/words/validate` · `POST /api/words/import` · `WS /ws/train`.

---

## How to add a new heuristic feature

1. **Python (source of truth):** add the snake_case name to `FEATURE_ORDER` in `trainer/.../wordle/types.py`, add its camelCase mapping, and implement it in `trainer/.../features/feature_extractor.py`. Add a test in `trainer/tests/test_features.py`.
2. **Frontend:** add the matching camelCase name to `FEATURE_ORDER` and a label/blurb in `apps/web/src/engine/types.ts → FEATURE_META`. The weight visualizer, population table, and explainability panel pick it up automatically. (The Local demo engine also implements features in `apps/web/src/engine/features.ts` — mirror it there if you want Local mode to use the new feature too.)
3. Keep the two `FEATURE_ORDER` lists in the same order so serialized weight vectors line up.

---

## Project layout

```
apps/web/           Vite + React + TS dashboard
  src/api/          REST client, WebSocket, shared API types
  src/hooks/        useEvolution (local worker), usePythonLab (backend), useBackend
  src/engine/       browser Wordle engine (Local demo + replay engine)
  src/ga/           browser GA (Local demo)
  src/components/    UI: control panel, charts, boards, tables, panels, mode bar
trainer/            Python 3.12 trainer
  src/wordle_evolution/
    wordle/         scoring (two-pass), candidate filter, word lists
    features/       the 12 heuristic features + entropy/frequency helpers
    ga/             chromosome, population, selection, crossover, mutation, evolution, fitness
    baselines/      random / frequency / entropy / candidate bots
    server/         FastAPI app, schemas, training manager, websocket
    io/             artifact save/load, word import
    experiments/    run_experiment (pnpm train), compare_runs
  tests/            pytest suites
  artifacts/        saved runs (git-ignored)
```

Bot nicknames (*Caveman Guesser, Vowel Goblin, Entropy Enjoyer, Candidate Sniper, Mutation Gremlin, The Chosen Bot*) are affectionate homage — no branding borrowed.
