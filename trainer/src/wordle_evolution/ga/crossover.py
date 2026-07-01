"""Crossover operators: uniform swap and arithmetic BLX-style blend."""

from __future__ import annotations

from ..wordle.types import FEATURE_ORDER
from .chromosome import Chromosome, clamp_weight


def _uniform_child_weights(a: dict[str, float], b: dict[str, float], rng) -> dict[str, float]:
    """Each gene comes from parent A or B with equal probability."""
    return {
        f: (a.get(f, 0.0) if rng.random() < 0.5 else b.get(f, 0.0))
        for f in FEATURE_ORDER
    }


def _blend_child_weights(a: dict[str, float], b: dict[str, float], rng, alpha: float = 0.3) -> dict[str, float]:
    """BLX-alpha blend: each gene drawn uniformly from an interval around [a, b]."""
    weights: dict[str, float] = {}
    for f in FEATURE_ORDER:
        av = a.get(f, 0.0)
        bv = b.get(f, 0.0)
        lo, hi = (av, bv) if av <= bv else (bv, av)
        span = hi - lo
        low = lo - alpha * span
        high = hi + alpha * span
        weights[f] = clamp_weight(rng.uniform(low, high))
    return weights


def crossover(
    parent_a: Chromosome,
    parent_b: Chromosome,
    rng,
    child_id: str,
    generation: int,
    *,
    blend_alpha: float = 0.3,
) -> Chromosome:
    """Produce one child, randomly choosing uniform or arithmetic-blend crossover.

    The child's mutation_rate is the average of its parents'; species is
    inherited from the fitter-ordered parent A.
    """
    if rng.random() < 0.5:
        weights = _uniform_child_weights(parent_a.weights, parent_b.weights, rng)
    else:
        weights = _blend_child_weights(parent_a.weights, parent_b.weights, rng, blend_alpha)

    mutation_rate = (parent_a.mutation_rate + parent_b.mutation_rate) / 2.0
    return Chromosome(
        id=child_id,
        weights=weights,
        mutation_rate=mutation_rate,
        generation_born=generation,
        species=parent_a.species,
    )
