"""Shared Wordle types, the canonical feature order, and snake<->camel helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Mapping

TileState = Literal["correct", "present", "absent"]

# Canonical order of the 12 heuristic features (snake_case, internal representation).
FEATURE_ORDER: tuple[str, ...] = (
    "candidate_bonus",
    "entropy_score",
    "expected_remaining_penalty",
    "letter_frequency_score",
    "positional_frequency_score",
    "unique_letter_bonus",
    "duplicate_letter_penalty",
    "vowel_coverage_score",
    "known_green_bonus",
    "known_yellow_bonus",
    "known_absent_penalty",
    "endgame_candidate_pressure",
)

# Exact snake_case -> camelCase mapping for the JSON boundary.
SNAKE_TO_CAMEL: dict[str, str] = {
    "candidate_bonus": "candidateBonus",
    "entropy_score": "entropyScore",
    "expected_remaining_penalty": "expectedRemainingPenalty",
    "letter_frequency_score": "letterFrequencyScore",
    "positional_frequency_score": "positionalFrequencyScore",
    "unique_letter_bonus": "uniqueLetterBonus",
    "duplicate_letter_penalty": "duplicateLetterPenalty",
    "vowel_coverage_score": "vowelCoverageScore",
    "known_green_bonus": "knownGreenBonus",
    "known_yellow_bonus": "knownYellowBonus",
    "known_absent_penalty": "knownAbsentPenalty",
    "endgame_candidate_pressure": "endgameCandidatePressure",
}

CAMEL_TO_SNAKE: dict[str, str] = {v: k for k, v in SNAKE_TO_CAMEL.items()}


def to_camel_weights(weights: Mapping[str, float]) -> dict[str, float]:
    """Convert a snake_case feature-weight dict into camelCase keys.

    Unknown keys are passed through unchanged so callers never lose data.
    """
    out: dict[str, float] = {}
    for key, value in weights.items():
        out[SNAKE_TO_CAMEL.get(key, key)] = float(value)
    return out


def to_snake_weights(weights: Mapping[str, float]) -> dict[str, float]:
    """Convert a camelCase feature-weight dict back into snake_case keys."""
    out: dict[str, float] = {}
    for key, value in weights.items():
        out[CAMEL_TO_SNAKE.get(key, key)] = float(value)
    return out


@dataclass(frozen=True)
class GuessRecord:
    """A single played guess and the feedback it produced."""

    guess: str
    feedback: tuple[TileState, ...]

    def __post_init__(self) -> None:  # pragma: no cover - trivial validation
        if len(self.guess) != 5:
            raise ValueError(f"guess must be 5 letters, got {self.guess!r}")
        if len(self.feedback) != 5:
            raise ValueError(f"feedback must have 5 tiles, got {self.feedback!r}")


VOWELS: frozenset[str] = frozenset("aeiou")
