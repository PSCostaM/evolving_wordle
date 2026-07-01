"""Tests for feature extraction and entropy behaviour."""

from wordle_evolution.features.entropy import shannon_entropy
from wordle_evolution.features.feature_extractor import (
    PlayerConfig,
    extract_features,
    choose_guess,
)
from wordle_evolution.ga.chromosome import Chromosome
from wordle_evolution.wordle.types import FEATURE_ORDER
from wordle_evolution.wordle.words import ANSWERS


def test_singleton_candidate_entropy_is_zero():
    assert shannon_entropy("crane", ["crane"], 0) == 0.0
    assert shannon_entropy("slate", ["crane"], 0) == 0.0


def test_splitting_guess_has_higher_entropy():
    candidates = list(ANSWERS)
    # 'crane' uses common, spread-out letters -> splits candidates finely.
    # 'fuzzy' has rare/duplicated letters -> collapses many into one bucket.
    high = shannon_entropy("crane", candidates, 128)
    low = shannon_entropy("fuzzy", candidates, 128)
    assert high > low


def test_feature_dict_has_all_twelve_nonnegative():
    cfg = PlayerConfig()
    feats = extract_features("crane", list(ANSWERS[:200]), [], 1, cfg)
    assert set(feats.keys()) == set(FEATURE_ORDER)
    assert len(feats) == 12
    assert all(v >= 0.0 for v in feats.values())


def test_candidate_bonus_is_one_for_candidate():
    cfg = PlayerConfig()
    cands = ["crane", "slate", "trace"]
    feats = extract_features("crane", cands, [], 1, cfg)
    assert feats["candidate_bonus"] == 1.0
    feats_non = extract_features("fuzzy", cands, [], 1, cfg)
    assert feats_non["candidate_bonus"] == 0.0


def test_choose_guess_is_deterministic_and_explainable():
    chrom = Chromosome(
        id="x",
        weights={f: 1.0 for f in FEATURE_ORDER},
        mutation_rate=0.1,
        generation_born=0,
    )
    cfg = PlayerConfig(pool_cap=40, opener_pool_cap=40, entropy_subsample_cap=16)
    cands = list(ANSWERS[:120])
    d1 = choose_guess(chrom, None, cands, [], 1, cfg)
    d2 = choose_guess(chrom, None, cands, [], 1, cfg)
    assert d1.guess == d2.guess
    # weighted_breakdown covers all 12 features and sums to the reported score.
    assert set(d1.weighted_breakdown.keys()) == set(FEATURE_ORDER)
    assert abs(sum(d1.weighted_breakdown.values()) - d1.score) < 1e-6
    assert len(d1.top_candidates) <= 5
    assert d1.top_candidates[0].word == d1.guess


def test_entropy_weight_zeroed_when_disabled():
    chrom = Chromosome(
        id="x",
        weights={f: 0.0 for f in FEATURE_ORDER} | {"entropy_score": 5.0},
        mutation_rate=0.1,
        generation_born=0,
    )
    cfg = PlayerConfig(use_entropy=False, pool_cap=30, opener_pool_cap=30)
    d = choose_guess(chrom, None, list(ANSWERS[:80]), [], 1, cfg)
    assert d.weighted_breakdown["entropy_score"] == 0.0
