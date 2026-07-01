"""Core Wordle engine: scoring, candidate filtering, word lists, shared types."""

from .scoring import score_guess, encode_pattern, decode_pattern
from .candidate_filter import filter_candidates
from .words import ANSWERS, GUESSES, is_answer, default_word_lists
from .types import (
    TileState,
    GuessRecord,
    FEATURE_ORDER,
    SNAKE_TO_CAMEL,
    CAMEL_TO_SNAKE,
    to_camel_weights,
    to_snake_weights,
)

__all__ = [
    "score_guess",
    "encode_pattern",
    "decode_pattern",
    "filter_candidates",
    "ANSWERS",
    "GUESSES",
    "is_answer",
    "default_word_lists",
    "TileState",
    "GuessRecord",
    "FEATURE_ORDER",
    "SNAKE_TO_CAMEL",
    "CAMEL_TO_SNAKE",
    "to_camel_weights",
    "to_snake_weights",
]
