"""FastAPI application exposing the trainer over REST + WebSocket.

Every response body is camelCase (the frontend contract). Internal snake_case
objects are converted through :mod:`wordle_evolution.server.schemas`.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from .. import __version__
from ..features.feature_extractor import PlayerConfig
from ..ga.evolution import EvolutionConfig
from ..ga.fitness import FitnessConfig
from ..io.artifacts import list_runs, load_latest, load_run
from ..io.import_words import import_word_lists, validate_words
from ..wordle.words import ANSWERS, GUESSES
from . import schemas
from .websocket import train_ws

app = FastAPI(title="Wordle Evolution Trainer", version=__version__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Health & config
# --------------------------------------------------------------------------- #
@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


@app.get("/api/config/defaults")
def config_defaults() -> dict:
    return {
        "config": schemas.evolution_config_model(EvolutionConfig()).dump(),
        "fitness": schemas.fitness_config_model(FitnessConfig()).dump(),
    }


# --------------------------------------------------------------------------- #
# Artifacts
# --------------------------------------------------------------------------- #
@app.get("/api/artifacts/latest")
def artifacts_latest() -> dict:
    bundle = load_latest()
    if bundle is None:
        raise HTTPException(status_code=404, detail="no artifacts found")
    return bundle


@app.get("/api/artifacts/runs")
def artifacts_runs() -> list:
    return list_runs()


@app.get("/api/artifacts/runs/{run_id}")
def artifacts_run(run_id: str) -> dict:
    bundle = load_run(run_id)
    if bundle is None:
        raise HTTPException(status_code=404, detail=f"run not found: {run_id}")
    return bundle


# --------------------------------------------------------------------------- #
# Training (offline / synchronous-friendly)
# --------------------------------------------------------------------------- #
@app.post("/api/train/offline")
async def train_offline(body: schemas.TrainConfig) -> dict:
    from ..experiments.run_experiment import run_and_save

    config = schemas.build_evolution_config(body)
    bundle = await run_in_threadpool(run_and_save, config)
    return {"runId": bundle["runId"], "summary": bundle["experimentSummary"]}


# --------------------------------------------------------------------------- #
# Champion replay
# --------------------------------------------------------------------------- #
@app.post("/api/champion/replay")
def champion_replay(body: schemas.ReplayRequest) -> dict:
    answer = body.answer.strip().lower()
    if len(answer) != 5 or not answer.isalpha():
        raise HTTPException(status_code=400, detail="answer must be a 5-letter word")
    player_config = PlayerConfig()
    match = schemas.build_replay_match(
        body.weights,
        answer,
        ANSWERS,
        GUESSES,
        player_config,
        label=answer,
        bot_kind="champion",
        include_decision=True,
        mutation_rate=body.mutation_rate,
    )
    return match.dump()


# --------------------------------------------------------------------------- #
# Baseline comparison
# --------------------------------------------------------------------------- #
@app.post("/api/baselines/compare")
async def baselines_compare(body: schemas.BaselinesCompareRequest) -> list:
    from ..baselines import evaluate_baselines

    summaries = await run_in_threadpool(
        evaluate_baselines,
        body.keys,
        body.sample_size,
        champion_weights=body.champion_weights,
    )
    return [schemas.baseline_summary_model(s).dump() for s in summaries]


# --------------------------------------------------------------------------- #
# Word list utilities
# --------------------------------------------------------------------------- #
@app.post("/api/words/validate")
def words_validate(body: schemas.WordsValidateRequest) -> dict:
    source = body.text if body.text is not None else (body.words or [])
    result = validate_words(source)
    return {"valid": result.valid, "invalid": result.invalid}


@app.post("/api/words/import")
def words_import(body: schemas.WordsImportRequest) -> dict:
    result = import_word_lists(body.answers, body.guesses)
    return {"answers": result.answers, "guesses": result.guesses, "added": result.added}


# --------------------------------------------------------------------------- #
# WebSocket
# --------------------------------------------------------------------------- #
@app.websocket("/ws/train")
async def ws_train(websocket: WebSocket) -> None:
    await train_ws(websocket)
