"""Initial population construction: seeded champion species + random fill."""

from __future__ import annotations

from ..utils.seed import make_rng
from .chromosome import (
    Chromosome,
    SPECIES_NAMES,
    species_weights,
    species_mutation_rate,
    random_weights,
)


def initialize_population(
    size: int,
    seed: str,
    base_mutation_rate: float = 0.15,
    generation: int = 0,
) -> list[Chromosome]:
    """Create ``size`` chromosomes: one per seeded species, then random fill.

    Deterministic given ``(size, seed)``.
    """
    rng = make_rng(seed, "init_population", generation)
    population: list[Chromosome] = []

    # Seeded champion species first.
    for i, species in enumerate(SPECIES_NAMES):
        if len(population) >= size:
            break
        population.append(
            Chromosome(
                id=f"seed-{i}-{species.replace(' ', '_').lower()}",
                weights=species_weights(species),
                mutation_rate=species_mutation_rate(species, base_mutation_rate),
                generation_born=generation,
                species=species,
            )
        )

    # Random-weight fill for the remainder.
    idx = 0
    while len(population) < size:
        population.append(
            Chromosome(
                id=f"rand-{idx}",
                weights=random_weights(rng),
                mutation_rate=base_mutation_rate,
                generation_born=generation,
                species=None,
            )
        )
        idx += 1

    return population
