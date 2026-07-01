"""Cooperative, pausable training run driven over a WebSocket.

The GA is CPU-bound, so each generation is stepped inside a thread executor
while the asyncio event loop stays free to handle pause/stop control messages
promptly. Events are pushed through an async ``emit`` callback.
"""

from __future__ import annotations

import asyncio
import os
import traceback
from concurrent.futures import Executor, ProcessPoolExecutor
from typing import Awaitable, Callable

from ..ga.evolution import Evolution, EvolutionConfig, GenerationReport
from ..utils.seed import make_rng
from ..utils.timing import Stopwatch
from ..wordle.words import ANSWERS, GUESSES
from . import schemas

EmitFn = Callable[[dict], Awaitable[None]]


def _resolve_worker_count() -> int:
    """How many worker processes to score the population with.

    Defaults to (cores - 1) so the event loop keeps a core free; override with
    ``WORDLE_EVAL_WORKERS`` (set to 0 or 1 to force the serial in-process path).
    """
    override = os.environ.get("WORDLE_EVAL_WORKERS")
    if override is not None:
        try:
            return max(0, int(override))
        except ValueError:
            return 0
    return max(1, (os.cpu_count() or 2) - 1)


def build_generation_event(
    report: GenerationReport,
    config: EvolutionConfig,
) -> dict:
    """Build the ``generation_complete`` event (mixed snake/camel per contract)."""
    champ = report.champion
    # A single deterministic champion replay for this generation.
    rng = make_rng(config.seed, "ws_replay", report.generation)
    answer = rng.choice(list(ANSWERS))
    sample_replay = schemas.build_replay_match(
        schemas.to_camel_weights(champ.chromosome.weights),
        answer,
        ANSWERS,
        GUESSES,
        config.player_config(),
        label=answer,
        bot_kind="champion",
        include_decision=True,
    )
    return {
        "type": "generation_complete",
        "generation": report.generation,
        "best_fitness": report.best_fitness,
        "average_fitness": report.avg_fitness,
        "best_win_rate": champ.stats.win_rate,
        "best_average_guesses": champ.stats.avg_guesses,
        "diversity": report.diversity_score,
        "champion": schemas.chromosome_model(champ.chromosome).dump(),
        "report": schemas.generation_report_model(report).dump(),
        "sample_replay": sample_replay.dump(),
    }


class TrainingManager:
    """Owns a single evolution run and streams events through ``emit``."""

    def __init__(self, config: EvolutionConfig, emit: EmitFn) -> None:
        self.config = config
        self.emit = emit
        self.evolution = Evolution(config)
        self.reports: list[GenerationReport] = []

        self._resume = asyncio.Event()
        self._resume.set()  # set => running (not paused)
        self._stop = False
        self._task: asyncio.Task | None = None
        self._watch = Stopwatch()
        self._pool: Executor | None = None

    # -- lifecycle ---------------------------------------------------------- #
    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stop = False
            self._resume.set()
            self._watch.reset()
            self._task = asyncio.ensure_future(self._run())

    async def pause(self) -> None:
        self._resume.clear()
        await self.emit({"type": "training_paused"})

    async def resume(self) -> None:
        self._resume.set()
        await self.emit({"type": "training_resumed"})

    async def stop(self) -> None:
        self._stop = True
        self._resume.set()  # unblock a paused loop so it can exit
        if self._task is not None:
            try:
                await self._task
            except asyncio.CancelledError:  # pragma: no cover - defensive
                pass

    async def reset(self) -> None:
        await self.stop()
        self.evolution = Evolution(self.config)
        self.reports = []

    # -- run loop ----------------------------------------------------------- #
    def _progress_emitter(
        self, loop: asyncio.AbstractEventLoop, generation: int, total: int
    ) -> Callable[[int, int], None]:
        """A thread-safe ``on_progress`` that streams throttled progress events.

        The GA step runs in a worker thread (and its workers in separate
        processes), so we hop back onto the event loop with
        ``run_coroutine_threadsafe`` to emit. Throttled to ~25 updates/generation.
        """
        stride = max(1, total // 25)

        def on_progress(done: int, count: int) -> None:
            if done != count and done % stride != 0:
                return
            event = {
                "type": "generation_progress",
                "generation": generation,
                "evaluated": done,
                "total": count,
            }
            try:
                asyncio.run_coroutine_threadsafe(self.emit(event), loop)
            except RuntimeError:  # pragma: no cover - loop shutting down
                pass

        return on_progress

    async def _run(self) -> None:
        loop = asyncio.get_running_loop()
        workers = _resolve_worker_count()
        self._pool = ProcessPoolExecutor(max_workers=workers) if workers > 1 else None
        try:
            await self.emit({"type": "training_started"})
            while not self.evolution.is_done() and not self._stop:
                await self._resume.wait()  # blocks while paused
                if self._stop:
                    break
                generation = self.evolution.generation
                total = self.config.population_size
                # Emit 0/total up front so the bar shows life the instant a
                # generation begins (before the first chromosome finishes).
                await self.emit(
                    {
                        "type": "generation_progress",
                        "generation": generation,
                        "evaluated": 0,
                        "total": total,
                    }
                )
                on_progress = self._progress_emitter(loop, generation, total)
                pool = self._pool
                report = await loop.run_in_executor(
                    None,
                    lambda: self.evolution.step(on_progress=on_progress, executor=pool),
                )
                self.reports.append(report)
                await self.emit(build_generation_event(report, self.config))
                await asyncio.sleep(0)  # cooperatively yield

            if self._stop:
                await self.emit({"type": "training_complete", "reason": "stopped"})
                return

            # Completed naturally: persist artifacts.
            await loop.run_in_executor(None, self._save_artifacts)
            await self.emit({"type": "training_complete", "reason": "completed"})
        except Exception as exc:  # pragma: no cover - defensive
            traceback.print_exc()
            await self.emit({"type": "error", "message": str(exc)})
        finally:
            if self._pool is not None:
                self._pool.shutdown(wait=False, cancel_futures=True)
                self._pool = None

    def _save_artifacts(self) -> None:
        from ..experiments.run_experiment import build_artifacts
        from ..io.artifacts import save_run

        if not self.reports:
            return
        bundle = build_artifacts(self.evolution, self.reports, self._watch.elapsed_ms())
        save_run(
            bundle["champion"],
            bundle["generationHistory"],
            bundle["replaySamples"],
            bundle["baselineComparison"],
            bundle["experimentSummary"],
        )
