"""Run one offline training experiment and persist its artifacts.

Usable both as a CLI (``python -m wordle_evolution.experiments.run_experiment``)
and as an importable pipeline (``run_and_save``) reused by the API server.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from typing import Callable, Optional

from ..baselines import evaluate_baselines
from ..ga.evolution import Evolution, EvolutionConfig, GenerationReport
from ..utils.seed import make_rng
from ..utils.timing import Stopwatch
from ..wordle.words import ANSWERS, GUESSES
from ..io.artifacts import make_run_id, save_run
from ..server import schemas


# --------------------------------------------------------------------------- #
# Artifact builders
# --------------------------------------------------------------------------- #
def generation_history_row(report: GenerationReport) -> dict:
    """A compact camelCase summary row for one generation."""
    return {
        "generation": report.generation,
        "evaluations": report.evaluations,
        "bestFitness": report.best_fitness,
        "avgFitness": report.avg_fitness,
        "medianFitness": report.median_fitness,
        "winRate": report.win_rate,
        "avgGuesses": report.avg_guesses,
        "diversityScore": report.diversity_score,
        "championId": report.champion.chromosome.id,
        "championNickname": report.champion.nickname,
        "elapsedMs": report.elapsed_ms,
    }


def build_replay_samples(
    champion_weights: dict[str, float],
    config: EvolutionConfig,
    *,
    count: int = 4,
    answers=ANSWERS,
    valid_guesses=GUESSES,
) -> list[dict]:
    """Build a few full champion replay matches (with per-turn decisions)."""
    rng = make_rng(config.seed, "replay_sample")
    k = min(count, len(answers))
    sample = rng.sample(list(answers), k)
    player_config = config.player_config()
    out: list[dict] = []
    for answer in sample:
        match = schemas.build_replay_match(
            champion_weights,
            answer,
            answers,
            valid_guesses,
            player_config,
            label=answer,
            bot_kind="champion",
            include_decision=True,
        )
        out.append(match.dump())
    return out


def build_artifacts(
    evolution: Evolution,
    reports: list[GenerationReport],
    duration_ms: int,
    *,
    run_id: Optional[str] = None,
    baseline_sample_size: int = 100,
) -> dict:
    """Assemble all five artifact payloads (camelCase) from a finished run."""
    config = evolution.config
    champion = evolution.best_overall or reports[-1].champion
    champion_weights_camel = schemas.to_camel_weights(champion.chromosome.weights)
    run_id = run_id or make_run_id(config.seed)
    timestamp = datetime.now(timezone.utc).isoformat()

    champion_json = schemas.champion_model(champion).dump()
    history = [generation_history_row(r) for r in reports]
    replays = build_replay_samples(champion_weights_camel, config)

    baselines = evaluate_baselines(
        keys=["random", "frequency", "candidate", "entropy"],
        sample_size=baseline_sample_size,
        seed=config.seed,
        max_turns=config.max_turns,
        fitness_config=config.fitness_config,
        champion_weights=champion.chromosome.weights,
    )
    baseline_json = [schemas.baseline_summary_model(b).dump() for b in baselines]

    summary = schemas.ExperimentSummaryJSON(
        run_id=run_id,
        seed=config.seed,
        config=schemas.evolution_config_model(config),
        generations=len(reports),
        timestamp=timestamp,
        duration_ms=duration_ms,
        final_champion_id=champion.chromosome.id,
        best_fitness=champion.fitness,
    ).dump()

    return {
        "runId": run_id,
        "champion": champion_json,
        "generationHistory": history,
        "replaySamples": replays,
        "baselineComparison": baseline_json,
        "experimentSummary": summary,
    }


def run_and_save(
    config: EvolutionConfig,
    *,
    on_generation: Callable[[GenerationReport], None] | None = None,
    baseline_sample_size: int = 100,
    answers=ANSWERS,
    valid_guesses=GUESSES,
) -> dict:
    """Run the full GA, build artifacts, persist them, and return the bundle.

    The returned dict includes ``runId`` and ``experimentSummary``.
    """
    evolution = Evolution(config, answers=answers, valid_guesses=valid_guesses)
    watch = Stopwatch()
    reports: list[GenerationReport] = []

    def collect(report: GenerationReport) -> None:
        reports.append(report)
        if on_generation is not None:
            on_generation(report)

    evolution.run_evolution(on_generation=collect)
    duration_ms = watch.elapsed_ms()

    bundle = build_artifacts(
        evolution, reports, duration_ms, baseline_sample_size=baseline_sample_size
    )
    run_id = save_run(
        bundle["champion"],
        bundle["generationHistory"],
        bundle["replaySamples"],
        bundle["baselineComparison"],
        bundle["experimentSummary"],
    )
    bundle["runId"] = run_id
    return bundle


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _parse_args(argv=None) -> argparse.Namespace:
    defaults = EvolutionConfig()
    parser = argparse.ArgumentParser(
        prog="run_experiment", description="Train the heuristic Wordle bot with a GA."
    )
    parser.add_argument("--generations", type=int, default=defaults.generations)
    parser.add_argument("--population", type=int, default=defaults.population_size)
    parser.add_argument("--sample", type=int, default=defaults.training_sample_size)
    parser.add_argument("--seed", type=str, default=defaults.seed)
    parser.add_argument("--elite", type=int, default=defaults.elite_count)
    parser.add_argument("--tournament", type=int, default=defaults.tournament_size)
    parser.add_argument("--no-entropy", action="store_true", help="disable entropy features")
    parser.add_argument(
        "--baseline-sample", type=int, default=100, help="sample size for baseline comparison"
    )
    parser.add_argument(
        "--pool-cap", type=int, default=defaults.pool_cap, help="per-turn scoring pool cap"
    )
    parser.add_argument(
        "--entropy-cap",
        type=int,
        default=defaults.entropy_subsample_cap,
        help="entropy candidate subsample cap",
    )
    return parser.parse_args(argv)


def main(argv=None) -> None:
    from rich.console import Console
    from rich.table import Table

    args = _parse_args(argv)
    console = Console()

    config = EvolutionConfig(
        population_size=args.population,
        generations=args.generations,
        elite_count=min(args.elite, args.population),
        tournament_size=args.tournament,
        training_sample_size=args.sample,
        validation_sample_size=args.sample,
        seed=args.seed,
        use_entropy=not args.no_entropy,
        pool_cap=args.pool_cap,
        entropy_subsample_cap=args.entropy_cap,
    )

    console.rule("[bold]Wordle Evolution — offline training")
    console.print(
        f"population={config.population_size} generations={config.generations} "
        f"sample={config.training_sample_size} seed={config.seed!r} "
        f"entropy={config.use_entropy}"
    )

    def on_gen(report: GenerationReport) -> None:
        console.print(
            f"gen [bold cyan]{report.generation:>3}[/] | "
            f"best={report.best_fitness:>10.1f} avg={report.avg_fitness:>10.1f} | "
            f"champWR={report.win_rate:5.2f} avgGuess={report.avg_guesses:5.2f} | "
            f"div={report.diversity_score:4.2f} | {report.elapsed_ms:>5}ms | "
            f"[magenta]{report.champion.nickname}[/]"
        )

    bundle = run_and_save(config, on_generation=on_gen, baseline_sample_size=args.baseline_sample)

    summary = bundle["experimentSummary"]
    champ = bundle["champion"]

    table = Table(title="Final Champion", show_header=True, header_style="bold")
    table.add_column("metric")
    table.add_column("value", justify="right")
    stats = champ["stats"]
    table.add_row("runId", str(summary["runId"]))
    table.add_row("nickname", champ["nickname"])
    table.add_row("fitness", f"{champ['fitness']:.1f}")
    table.add_row("winRate", f"{stats['winRate']:.3f}")
    table.add_row("avgGuesses", f"{stats['avgGuesses']:.3f}")
    table.add_row("solvedIn3OrLessRate", f"{stats['solvedIn3OrLessRate']:.3f}")
    table.add_row("hardWordSuccessRate", f"{stats['hardWordSuccessRate']:.3f}")
    table.add_row("histogram", str(stats["histogram"]))
    table.add_row("durationMs", str(summary["durationMs"]))
    console.print(table)

    bt = Table(title="Baseline comparison", show_header=True, header_style="bold")
    bt.add_column("key")
    bt.add_column("winRate", justify="right")
    bt.add_column("avgGuesses", justify="right")
    bt.add_column("fitness", justify="right")
    for b in bundle["baselineComparison"]:
        bt.add_row(b["key"], f"{b['winRate']:.3f}", f"{b['avgGuesses']:.3f}", f"{b['fitness']:.1f}")
    console.print(bt)
    console.print(f"[green]Artifacts saved.[/] runId=[bold]{summary['runId']}[/]")


if __name__ == "__main__":
    main()
