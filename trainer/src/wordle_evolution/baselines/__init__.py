"""Baseline Wordle bots and a shared evaluation harness.

Each baseline exposes a ``select(candidates, rng)`` rule that picks a guess from
the remaining candidate answers, plus an ``evaluate(...)`` convenience. The
shared runner here turns a rule into a :class:`BaselineSummary`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from ..features.feature_extractor import PlayerConfig
from ..ga.fitness import (
    FitnessConfig,
    GameResult,
    compute_fitness,
    stats_from_games,
)
from ..utils.seed import make_rng
from ..wordle.candidate_filter import filter_candidates
from ..wordle.scoring import score_guess_cached
from ..wordle.types import GuessRecord
from ..wordle.words import ANSWERS, GUESSES

from .random_bot import select as random_select, KEY as RANDOM_KEY, NAME as RANDOM_NAME
from .frequency_bot import select as frequency_select, KEY as FREQUENCY_KEY, NAME as FREQUENCY_NAME
from .entropy_bot import select as entropy_select, KEY as ENTROPY_KEY, NAME as ENTROPY_NAME
from .candidate_bot import select as candidate_select, KEY as CANDIDATE_KEY, NAME as CANDIDATE_NAME

SelectFn = Callable[[list[str], object], str]


@dataclass
class BaselineSummary:
    key: str
    name: str
    win_rate: float
    avg_guesses: float
    failures: int
    games: int
    histogram: list[int] = field(default_factory=lambda: [0, 0, 0, 0, 0, 0, 0])
    fitness: float = 0.0


# Registry of the four rule-based baselines.
BASELINES: dict[str, tuple[str, SelectFn]] = {
    RANDOM_KEY: (RANDOM_NAME, random_select),
    FREQUENCY_KEY: (FREQUENCY_NAME, frequency_select),
    ENTROPY_KEY: (ENTROPY_NAME, entropy_select),
    CANDIDATE_KEY: (CANDIDATE_NAME, candidate_select),
}


def play_baseline_game(
    select_fn: SelectFn,
    answer: str,
    answers,
    max_turns: int,
    rng,
    opener: str | None = None,
) -> GameResult:
    """Play one game where each guess is chosen from the remaining candidates."""
    possible = list(answers)
    history: list[GuessRecord] = []
    remaining_after_guess2: int | None = None
    solved = False
    guess_count = max_turns

    for turn in range(1, max_turns + 1):
        if not possible:
            break
        if turn == 1 and opener is not None:
            guess = opener
        else:
            guess = select_fn(possible, rng)
        feedback = score_guess_cached(guess, answer)
        history.append(GuessRecord(guess=guess, feedback=feedback))
        possible = filter_candidates(possible, guess, feedback)
        if turn == 2:
            remaining_after_guess2 = len(possible)
        if guess == answer:
            solved = True
            guess_count = turn
            break

    if remaining_after_guess2 is None:
        remaining_after_guess2 = len(possible)

    return GameResult(
        answer=answer,
        solved=solved,
        guess_count=guess_count,
        remaining_after_guess2=remaining_after_guess2,
        history=history,
    )


def evaluate_baseline(
    key: str,
    name: str,
    select_fn: SelectFn,
    sample: list[str],
    answers=ANSWERS,
    max_turns: int = 6,
    seed: str = "baseline",
    fitness_config: FitnessConfig | None = None,
) -> BaselineSummary:
    """Play a baseline over a sample of answers and summarize it."""
    rng = make_rng(seed, f"baseline_{key}")
    answer_pool = list(answers)
    # Compute the turn-1 opener once (deterministic, answer-independent) and reuse.
    opener = select_fn(answer_pool, rng) if answer_pool else None

    results: list[GameResult] = []
    for answer in sample:
        results.append(
            play_baseline_game(select_fn, answer, answer_pool, max_turns, rng, opener=opener)
        )

    stats = stats_from_games(results, max_turns)
    fitness = compute_fitness(stats, fitness_config)
    return BaselineSummary(
        key=key,
        name=name,
        win_rate=stats.win_rate,
        avg_guesses=stats.avg_guesses,
        failures=stats.histogram[0],
        games=stats.games,
        histogram=list(stats.histogram),
        fitness=fitness,
    )


def sample_answers(sample_size: int, seed: str = "baseline_sample", answers=ANSWERS) -> list[str]:
    rng = make_rng(seed, "sample")
    k = min(sample_size, len(answers))
    return rng.sample(list(answers), k)


def evaluate_baselines(
    keys: list[str] | None,
    sample_size: int,
    *,
    seed: str = "baseline",
    max_turns: int = 6,
    fitness_config: FitnessConfig | None = None,
    champion_weights: dict[str, float] | None = None,
    answers=ANSWERS,
    valid_guesses=GUESSES,
) -> list[BaselineSummary]:
    """Evaluate the requested baselines (and optionally a champion) on a sample."""
    keys = keys or list(BASELINES.keys())
    sample = sample_answers(sample_size, seed=seed, answers=answers)
    summaries: list[BaselineSummary] = []

    for key in keys:
        if key == "champion":
            continue
        entry = BASELINES.get(key)
        if entry is None:
            continue
        name, select_fn = entry
        summaries.append(
            evaluate_baseline(
                key, name, select_fn, sample, answers, max_turns, seed, fitness_config
            )
        )

    if champion_weights is not None:
        summaries.append(
            _evaluate_champion(
                champion_weights, sample, answers, valid_guesses, max_turns, seed, fitness_config
            )
        )

    return summaries


def _evaluate_champion(
    weights: dict[str, float],
    sample: list[str],
    answers,
    valid_guesses,
    max_turns: int,
    seed: str,
    fitness_config: FitnessConfig | None,
) -> BaselineSummary:
    """Evaluate an evolved champion (heuristic player) as the 'champion' summary."""
    from ..ga.chromosome import Chromosome
    from ..ga.fitness import evaluate_chromosome

    chrom = Chromosome(
        id="champion",
        weights=dict(weights),
        mutation_rate=0.0,
        generation_born=0,
        species=None,
    )
    player_config = PlayerConfig(max_turns=max_turns)
    result = evaluate_chromosome(
        chrom, sample, valid_guesses, player_config, seed=seed, fitness_config=fitness_config
    )
    stats = result.stats
    return BaselineSummary(
        key="champion",
        name="Evolved Champion",
        win_rate=stats.win_rate,
        avg_guesses=stats.avg_guesses,
        failures=stats.histogram[0],
        games=stats.games,
        histogram=list(stats.histogram),
        fitness=result.fitness,
    )


__all__ = [
    "BaselineSummary",
    "BASELINES",
    "play_baseline_game",
    "evaluate_baseline",
    "evaluate_baselines",
    "sample_answers",
]
