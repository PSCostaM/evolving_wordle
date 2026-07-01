"""Gaussian mutation with self-adapting rate and occasional large kicks."""

from __future__ import annotations

from ..wordle.types import FEATURE_ORDER
from .chromosome import Chromosome, clamp_weight, WEIGHT_MIN, WEIGHT_MAX

_MUTATION_RATE_MIN = 0.01
_MUTATION_RATE_MAX = 1.0


def mutate(
    chromosome: Chromosome,
    rng,
    *,
    large_mutation_chance: float = 0.03,
    sigma: float = 1.5,
    large_sigma: float = 6.0,
) -> Chromosome:
    """Return a mutated copy of ``chromosome``.

    Each gene is jittered by Gaussian noise scaled by the self-adapting
    ``mutation_rate``; with probability ``large_mutation_chance`` a gene instead
    receives a large kick. All weights are clamped to [-10, 10]. The mutation
    rate itself drifts slightly (self-adaptation).
    """
    rate = chromosome.mutation_rate
    new_weights: dict[str, float] = {}
    for f in FEATURE_ORDER:
        value = chromosome.weights.get(f, 0.0)
        if rng.random() < large_mutation_chance:
            value = value + rng.gauss(0.0, large_sigma)
        elif rng.random() < rate:
            value = value + rng.gauss(0.0, sigma * max(rate, _MUTATION_RATE_MIN))
        new_weights[f] = clamp_weight(value)

    # Self-adapt the mutation rate with a small log-normal-ish nudge.
    new_rate = rate * (1.0 + rng.gauss(0.0, 0.1))
    new_rate = max(_MUTATION_RATE_MIN, min(_MUTATION_RATE_MAX, new_rate))

    return Chromosome(
        id=chromosome.id,
        weights=new_weights,
        mutation_rate=new_rate,
        generation_born=chromosome.generation_born,
        species=chromosome.species,
    )
