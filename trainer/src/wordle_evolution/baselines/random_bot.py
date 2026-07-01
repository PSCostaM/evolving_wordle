"""Random baseline: guess a uniformly random remaining candidate."""

from __future__ import annotations

KEY = "random"
NAME = "Random Guesser"


def select(candidates: list[str], rng) -> str:
    """Pick a random candidate (deterministic given a seeded ``rng``)."""
    ordered = sorted(candidates)  # stable order so the seeded choice is reproducible
    return ordered[rng.randrange(len(ordered))]
