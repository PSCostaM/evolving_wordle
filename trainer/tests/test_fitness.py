"""Tests for fitness stats and the fitness formula."""

from wordle_evolution.ga.chromosome import Chromosome
from wordle_evolution.ga.fitness import (
    ChromosomeStats,
    FitnessConfig,
    FitnessResult,
    compute_fitness,
    evaluate_chromosome,
    is_hard_word,
    stats_from_games,
    GameResult,
)
from wordle_evolution.features.feature_extractor import PlayerConfig
from wordle_evolution.wordle.types import FEATURE_ORDER, GuessRecord
from wordle_evolution.wordle.words import ANSWERS, GUESSES


def test_hard_word_definition():
    assert is_hard_word("allee")  # repeated letters
    assert is_hard_word("abbey")
    assert not is_hard_word("crane")  # all distinct


def _game(answer, solved, guesses):
    return GameResult(
        answer=answer,
        solved=solved,
        guess_count=guesses,
        remaining_after_guess2=1,
        history=[],
    )


def test_stats_fields_and_bounds():
    results = [
        _game("crane", True, 2),
        _game("slate", True, 4),
        _game("abbey", False, 6),  # hard word, unsolved
    ]
    stats = stats_from_games(results, max_turns=6)
    assert stats.games == 3
    assert stats.wins == 2
    assert 0.0 <= stats.win_rate <= 1.0
    assert 0.0 <= stats.failure_rate <= 1.0
    assert abs(stats.win_rate + stats.failure_rate - 1.0) < 1e-9
    assert sum(stats.histogram) == stats.games
    assert len(stats.histogram) == 7
    assert stats.histogram[0] == 1  # one failure
    assert stats.histogram[2] == 1  # one solve in 2
    assert stats.histogram[4] == 1  # one solve in 4
    # 'abbey' is the only hard word and it was unsolved.
    assert stats.hard_word_success_rate == 0.0


def test_strictly_better_stats_yield_higher_fitness():
    worse = ChromosomeStats(
        games=100,
        wins=80,
        win_rate=0.80,
        failure_rate=0.20,
        avg_guesses=4.5,
        solved_in_3_or_less_rate=0.30,
        avg_remaining_candidates_after_guess_2=8.0,
        hard_word_success_rate=0.50,
        histogram=[20, 0, 10, 20, 30, 15, 5],
    )
    better = ChromosomeStats(
        games=100,
        wins=95,
        win_rate=0.95,
        failure_rate=0.05,
        avg_guesses=3.6,
        solved_in_3_or_less_rate=0.55,
        avg_remaining_candidates_after_guess_2=4.0,
        hard_word_success_rate=0.80,
        histogram=[5, 0, 25, 30, 25, 10, 5],
    )
    cfg = FitnessConfig()
    assert compute_fitness(better, cfg) > compute_fitness(worse, cfg)


def test_fitness_config_is_mutable():
    cfg = FitnessConfig()
    cfg.win_rate_weight = 1.0
    assert cfg.win_rate_weight == 1.0


def test_evaluate_chromosome_returns_result_with_bounds():
    chrom = Chromosome(
        id="c",
        weights={f: 1.0 for f in FEATURE_ORDER},
        mutation_rate=0.1,
        generation_born=0,
    )
    sample = list(ANSWERS[:12])
    cfg = PlayerConfig(pool_cap=30, opener_pool_cap=40, entropy_subsample_cap=12)
    result = evaluate_chromosome(chrom, sample, GUESSES, cfg, seed="t")
    assert isinstance(result, FitnessResult)
    assert result.stats.games == 12
    assert 0.0 <= result.stats.win_rate <= 1.0
    assert result.stats.avg_guesses > 0.0
    assert isinstance(result.fitness, float)


def test_common_random_numbers_same_sample_reproducible():
    chrom = Chromosome(
        id="c",
        weights={f: 1.0 for f in FEATURE_ORDER},
        mutation_rate=0.1,
        generation_born=0,
    )
    sample = list(ANSWERS[:12])
    cfg = PlayerConfig(pool_cap=30, opener_pool_cap=40, entropy_subsample_cap=12)
    r1 = evaluate_chromosome(chrom, sample, GUESSES, cfg, seed="t")
    r2 = evaluate_chromosome(chrom, sample, GUESSES, cfg, seed="t")
    assert r1.fitness == r2.fitness
    assert r1.stats.histogram == r2.stats.histogram
