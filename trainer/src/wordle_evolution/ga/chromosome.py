"""The Chromosome (a bag of feature weights) plus species seeding helpers."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..wordle.types import FEATURE_ORDER

WEIGHT_MIN: float = -10.0
WEIGHT_MAX: float = 10.0


def clamp_weight(value: float) -> float:
    return max(WEIGHT_MIN, min(WEIGHT_MAX, float(value)))


def clamp_weights(weights: dict[str, float]) -> dict[str, float]:
    return {k: clamp_weight(v) for k, v in weights.items()}


@dataclass
class Chromosome:
    id: str
    weights: dict[str, float]
    mutation_rate: float
    generation_born: int
    species: str | None = None

    def __post_init__(self) -> None:
        # Guarantee every feature is present and clamped.
        self.weights = {f: clamp_weight(self.weights.get(f, 0.0)) for f in FEATURE_ORDER}
        self.mutation_rate = float(self.mutation_rate)

    def copy_with(self, **changes) -> "Chromosome":
        return Chromosome(
            id=changes.get("id", self.id),
            weights=changes.get("weights", dict(self.weights)),
            mutation_rate=changes.get("mutation_rate", self.mutation_rate),
            generation_born=changes.get("generation_born", self.generation_born),
            species=changes.get("species", self.species),
        )


# --------------------------------------------------------------------------- #
# Species seeding
# --------------------------------------------------------------------------- #
# Each champion species biases weights toward its namesake behaviour. Values are
# starting points; evolution refines them. All are within [-10, 10].
_SPECIES_TEMPLATES: dict[str, dict[str, float]] = {
    "Vowel Goblin": {
        "vowel_coverage_score": 8.0,
        "unique_letter_bonus": 5.0,
        "letter_frequency_score": 4.0,
        "duplicate_letter_penalty": -3.0,
        "known_absent_penalty": -4.0,
    },
    "Entropy Enjoyer": {
        "entropy_score": 9.0,
        "expected_remaining_penalty": -7.0,
        "candidate_bonus": 2.0,
        "known_absent_penalty": -3.0,
    },
    "Candidate Sniper": {
        "candidate_bonus": 8.0,
        "endgame_candidate_pressure": 7.0,
        "known_green_bonus": 5.0,
        "known_yellow_bonus": 4.0,
        "known_absent_penalty": -5.0,
    },
    "Frequency Gremlin": {
        "letter_frequency_score": 8.0,
        "positional_frequency_score": 7.0,
        "unique_letter_bonus": 3.0,
        "duplicate_letter_penalty": -4.0,
    },
    "Balanced Bot": {
        "entropy_score": 4.0,
        "candidate_bonus": 3.0,
        "letter_frequency_score": 3.0,
        "positional_frequency_score": 3.0,
        "known_green_bonus": 3.0,
        "known_yellow_bonus": 2.0,
        "known_absent_penalty": -3.0,
        "expected_remaining_penalty": -3.0,
        "vowel_coverage_score": 2.0,
        "unique_letter_bonus": 2.0,
        "duplicate_letter_penalty": -2.0,
        "endgame_candidate_pressure": 3.0,
    },
    "Mutation Gremlin": {
        "entropy_score": 3.0,
        "candidate_bonus": 3.0,
        "letter_frequency_score": 2.0,
        "positional_frequency_score": 2.0,
        "vowel_coverage_score": 2.0,
    },
}

SPECIES_NAMES: tuple[str, ...] = tuple(_SPECIES_TEMPLATES.keys())

# Species whose defining trait is a higher mutation rate.
_HIGH_MUTATION_SPECIES = {"Mutation Gremlin"}


def species_weights(species: str) -> dict[str, float]:
    """Full 12-feature weight dict for a named species (missing -> 0)."""
    template = _SPECIES_TEMPLATES.get(species, {})
    return {f: clamp_weight(template.get(f, 0.0)) for f in FEATURE_ORDER}


def species_mutation_rate(species: str, base: float) -> float:
    if species in _HIGH_MUTATION_SPECIES:
        return min(1.0, base * 2.5)
    return base


def random_weights(rng, low: float = WEIGHT_MIN, high: float = WEIGHT_MAX) -> dict[str, float]:
    """Uniform-random weights in ``[low, high]`` from a ``random.Random``-like rng."""
    return {f: clamp_weight(rng.uniform(low, high)) for f in FEATURE_ORDER}


def make_chromosome(
    chrom_id: str,
    weights: dict[str, float],
    mutation_rate: float,
    generation_born: int,
    species: str | None = None,
) -> Chromosome:
    return Chromosome(
        id=chrom_id,
        weights=clamp_weights(weights),
        mutation_rate=mutation_rate,
        generation_born=generation_born,
        species=species,
    )


# --------------------------------------------------------------------------- #
# Diversity / nickname
# --------------------------------------------------------------------------- #
def cosine_distance(a: dict[str, float], b: dict[str, float]) -> float:
    """1 - cosine similarity of two weight vectors (0 = identical direction)."""
    dot = 0.0
    na = 0.0
    nb = 0.0
    for f in FEATURE_ORDER:
        av = a.get(f, 0.0)
        bv = b.get(f, 0.0)
        dot += av * bv
        na += av * av
        nb += bv * bv
    if na == 0.0 or nb == 0.0:
        return 1.0
    sim = dot / (math.sqrt(na) * math.sqrt(nb))
    sim = max(-1.0, min(1.0, sim))
    return 1.0 - sim


# Dominant-weight -> playful nickname. Reuses the species vocabulary.
_NICKNAME_BY_FEATURE: dict[str, str] = {
    "candidate_bonus": "Candidate Sniper",
    "entropy_score": "Entropy Enjoyer",
    "expected_remaining_penalty": "The Pruner",
    "letter_frequency_score": "Frequency Gremlin",
    "positional_frequency_score": "Position Wizard",
    "unique_letter_bonus": "Caveman Guesser",
    "duplicate_letter_penalty": "Duplicate Hater",
    "vowel_coverage_score": "Vowel Goblin",
    "known_green_bonus": "The Chosen Bot",
    "known_yellow_bonus": "Yellow Chaser",
    "known_absent_penalty": "Grudge Keeper",
    "endgame_candidate_pressure": "Clutch Closer",
}


def nickname(chromosome: Chromosome) -> str:
    """Derive a playful label from the chromosome's dominant (max |weight|) feature."""
    if not chromosome.weights:
        return "Balanced Bot"
    dominant = max(FEATURE_ORDER, key=lambda f: abs(chromosome.weights.get(f, 0.0)))
    if abs(chromosome.weights.get(dominant, 0.0)) < 1e-9:
        return "Balanced Bot"
    return _NICKNAME_BY_FEATURE.get(dominant, "Balanced Bot")
