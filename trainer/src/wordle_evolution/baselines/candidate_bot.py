"""Candidate baseline: always guess the first remaining candidate (lexicographic)."""

from __future__ import annotations

KEY = "candidate"
NAME = "Candidate Bot"


def select(candidates: list[str], rng=None) -> str:
    """Return the lexicographically first remaining candidate."""
    return min(candidates)
