"""Heuristic feature extraction and the explainable guess-selection routine."""

from .feature_extractor import (
    FeatureConfig,
    PlayerConfig,
    extract_features,
    choose_guess,
    build_pool,
    ScoredGuess,
    GuessDecision,
    KnownInfo,
    known_info_from_history,
)
from .entropy import pattern_distribution, shannon_entropy, expected_remaining
from .frequency import (
    letter_frequencies,
    positional_frequencies,
    letter_frequency_score,
    positional_frequency_score,
)

__all__ = [
    "FeatureConfig",
    "PlayerConfig",
    "extract_features",
    "choose_guess",
    "build_pool",
    "ScoredGuess",
    "GuessDecision",
    "KnownInfo",
    "known_info_from_history",
    "pattern_distribution",
    "shannon_entropy",
    "expected_remaining",
    "letter_frequencies",
    "positional_frequencies",
    "letter_frequency_score",
    "positional_frequency_score",
]
