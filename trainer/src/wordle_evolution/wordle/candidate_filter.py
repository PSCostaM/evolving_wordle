"""Filtering the set of still-possible answers given a guess and its feedback."""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from .scoring import score_guess_cached
from .types import TileState


def filter_candidates(
    candidates: Iterable[str],
    guess: str,
    feedback: Sequence[TileState],
) -> list[str]:
    """Keep only candidates that would have produced exactly ``feedback``.

    A word ``w`` survives iff ``score_guess(guess, w) == tuple(feedback)``.
    """
    target = tuple(feedback)
    return [w for w in candidates if score_guess_cached(guess, w) == target]
