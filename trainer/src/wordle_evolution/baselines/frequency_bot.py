"""Frequency baseline: guess the candidate with the highest letter-frequency score."""

from __future__ import annotations

from ..features.frequency import letter_frequencies, letter_frequency_score

KEY = "frequency"
NAME = "Frequency Bot"


def select(candidates: list[str], rng=None) -> str:
    """Candidate whose distinct letters are most common among the candidates.

    Ties break lexicographically (deterministic).
    """
    freqs = letter_frequencies(candidates)
    return max(
        sorted(candidates),
        key=lambda w: letter_frequency_score(w, freqs),
    )
