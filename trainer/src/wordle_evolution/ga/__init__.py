"""Genetic algorithm: chromosomes, operators, fitness, and the evolution loop."""

from .chromosome import (
    Chromosome,
    WEIGHT_MIN,
    WEIGHT_MAX,
    SPECIES_NAMES,
    clamp_weight,
    clamp_weights,
    random_weights,
    species_weights,
    make_chromosome,
    cosine_distance,
    nickname,
)
from .fitness import (
    ChromosomeStats,
    FitnessConfig,
    FitnessResult,
    evaluate_chromosome,
    compute_fitness,
    is_hard_word,
)
from .selection import tournament_select
from .crossover import crossover
from .mutation import mutate
from .population import initialize_population
from .evolution import Evolution, EvolutionConfig, GenerationReport, PopulationMember

__all__ = [
    "Chromosome",
    "WEIGHT_MIN",
    "WEIGHT_MAX",
    "SPECIES_NAMES",
    "clamp_weight",
    "clamp_weights",
    "random_weights",
    "species_weights",
    "make_chromosome",
    "cosine_distance",
    "nickname",
    "ChromosomeStats",
    "FitnessConfig",
    "FitnessResult",
    "evaluate_chromosome",
    "compute_fitness",
    "is_hard_word",
    "tournament_select",
    "crossover",
    "mutate",
    "initialize_population",
    "Evolution",
    "EvolutionConfig",
    "GenerationReport",
    "PopulationMember",
]
