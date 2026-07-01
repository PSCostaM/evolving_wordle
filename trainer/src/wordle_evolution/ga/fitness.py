"""Playing chromosomes over answers and turning the outcome into a fitness score."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..features.feature_extractor import PlayerConfig, choose_guess, GuessDecision
from ..wordle.candidate_filter import filter_candidates
from ..wordle.scoring import score_guess_cached
from ..wordle.types import GuessRecord


# --------------------------------------------------------------------------- #
# Hard-word definition (documented): a "hard" answer contains a repeated letter,
# e.g. "allee", "abbey", "erase". These are the words duplicate-letter naive
# strategies most often fail, so success on them is rewarded separately.
# --------------------------------------------------------------------------- #
def is_hard_word(answer: str) -> bool:
    return len(set(answer)) < len(answer)


# --------------------------------------------------------------------------- #
# Game playing
# --------------------------------------------------------------------------- #
@dataclass
class GameResult:
    answer: str
    solved: bool
    guess_count: int
    remaining_after_guess2: int
    history: list[GuessRecord]
    decisions: list[GuessDecision] = field(default_factory=list)


def play_chromosome_game(
    chromosome,
    answer: str,
    answers,
    valid_guesses,
    config: PlayerConfig,
    *,
    collect_decisions: bool = False,
    opener: GuessDecision | None = None,
) -> GameResult:
    """Play one Wordle game with a chromosome and return the outcome.

    ``opener`` is the turn-1 decision; since every game for a chromosome starts
    from the identical state, the caller can compute it once and reuse it.
    """
    possible: list[str] = list(answers)
    history: list[GuessRecord] = []
    decisions: list[GuessDecision] = []
    remaining_after_guess2: int | None = None
    solved = False
    guess_count = config.max_turns

    for turn in range(1, config.max_turns + 1):
        if turn == 1 and opener is not None:
            decision = opener
        else:
            decision = choose_guess(chromosome, valid_guesses, possible, history, turn, config)
        if collect_decisions:
            decisions.append(decision)
        guess = decision.guess
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
        decisions=decisions,
    )


# --------------------------------------------------------------------------- #
# Stats
# --------------------------------------------------------------------------- #
@dataclass
class ChromosomeStats:
    games: int = 0
    wins: int = 0
    win_rate: float = 0.0
    failure_rate: float = 0.0
    avg_guesses: float = 0.0
    solved_in_3_or_less_rate: float = 0.0
    avg_remaining_candidates_after_guess_2: float = 0.0
    hard_word_success_rate: float = 0.0
    histogram: list[int] = field(default_factory=lambda: [0, 0, 0, 0, 0, 0, 0])


def stats_from_games(results: list[GameResult], max_turns: int) -> ChromosomeStats:
    games = len(results)
    if games == 0:
        return ChromosomeStats()

    wins = 0
    total_guesses = 0.0
    solved_le3 = 0
    total_remaining = 0.0
    hard_total = 0
    hard_wins = 0
    histogram = [0, 0, 0, 0, 0, 0, 0]

    for r in results:
        if r.solved:
            wins += 1
            total_guesses += r.guess_count
            if r.guess_count <= 3:
                solved_le3 += 1
            slot = min(6, max(1, r.guess_count))
            histogram[slot] += 1
        else:
            total_guesses += max_turns  # a loss counts as the worst case
            histogram[0] += 1

        total_remaining += r.remaining_after_guess2

        if is_hard_word(r.answer):
            hard_total += 1
            if r.solved:
                hard_wins += 1

    return ChromosomeStats(
        games=games,
        wins=wins,
        win_rate=wins / games,
        failure_rate=(games - wins) / games,
        avg_guesses=total_guesses / games,
        solved_in_3_or_less_rate=solved_le3 / games,
        avg_remaining_candidates_after_guess_2=total_remaining / games,
        hard_word_success_rate=(hard_wins / hard_total) if hard_total else 0.0,
        histogram=histogram,
    )


# --------------------------------------------------------------------------- #
# Fitness
# --------------------------------------------------------------------------- #
@dataclass
class FitnessConfig:
    """Mutable coefficients for the fitness formula (easy to tune)."""

    win_rate_weight: float = 10000.0
    avg_guesses_weight: float = 800.0
    failure_rate_weight: float = 5000.0
    solved_in_3_weight: float = 1200.0
    avg_remaining_after_guess2_weight: float = 5.0
    hard_word_success_weight: float = 1500.0


def compute_fitness(stats: ChromosomeStats, config: FitnessConfig | None = None) -> float:
    cfg = config or FitnessConfig()
    return (
        stats.win_rate * cfg.win_rate_weight
        - stats.avg_guesses * cfg.avg_guesses_weight
        - stats.failure_rate * cfg.failure_rate_weight
        + stats.solved_in_3_or_less_rate * cfg.solved_in_3_weight
        - stats.avg_remaining_candidates_after_guess_2 * cfg.avg_remaining_after_guess2_weight
        + stats.hard_word_success_rate * cfg.hard_word_success_weight
    )


@dataclass
class FitnessResult:
    chromosome: object
    fitness: float
    stats: ChromosomeStats
    game_results: list[GameResult] = field(default_factory=list)


def evaluate_chromosome(
    chromosome,
    answers,
    valid_guesses,
    config: PlayerConfig | None = None,
    seed: str = "eval",
    *,
    fitness_config: FitnessConfig | None = None,
    collect_games: bool = False,
) -> FitnessResult:
    """Play ``chromosome`` over every answer in ``answers`` and score it.

    ``answers`` is the (already sampled) common set every chromosome in a
    generation must share (common-random-numbers). Play is fully deterministic
    given the chromosome and answer set, so ``seed`` is accepted for API
    symmetry but not required for reproducibility.
    """
    player_config = config or PlayerConfig()
    results: list[GameResult] = []
    # Turn 1 is identical for every game, so compute the opener once and reuse.
    opener = None
    if answers:
        opener = choose_guess(chromosome, valid_guesses, list(answers), [], 1, player_config)
    for answer in answers:
        results.append(
            play_chromosome_game(
                chromosome, answer, answers, valid_guesses, player_config, opener=opener
            )
        )

    stats = stats_from_games(results, player_config.max_turns)
    fitness = compute_fitness(stats, fitness_config)
    return FitnessResult(
        chromosome=chromosome,
        fitness=fitness,
        stats=stats,
        game_results=results if collect_games else [],
    )
