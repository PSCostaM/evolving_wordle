"""Tournament selection."""

from __future__ import annotations

from typing import Sequence


def tournament_select(
    population: Sequence,
    fitnesses: Sequence[float],
    tournament_size: int,
    rng,
):
    """Return the fittest individual from ``tournament_size`` random draws.

    ``rng`` is a ``random.Random``-like object (deterministic when seeded). Draws
    are with replacement. Ties resolve to the earliest-sampled index.
    """
    n = len(population)
    if n == 0:
        raise ValueError("cannot select from an empty population")
    k = max(1, min(tournament_size, n))
    indices = [rng.randrange(n) for _ in range(k)]
    best_idx = indices[0]
    best_fit = fitnesses[best_idx]
    for idx in indices[1:]:
        if fitnesses[idx] > best_fit:
            best_fit = fitnesses[idx]
            best_idx = idx
    return population[best_idx]
