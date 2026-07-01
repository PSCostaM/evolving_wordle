"""Tests for GA operators, seeding, and end-to-end determinism."""

from wordle_evolution.ga.chromosome import (
    Chromosome,
    WEIGHT_MIN,
    WEIGHT_MAX,
    random_weights,
)
from wordle_evolution.ga.crossover import (
    crossover,
    _uniform_child_weights,
    _blend_child_weights,
)
from wordle_evolution.ga.mutation import mutate
from wordle_evolution.ga.selection import tournament_select
from wordle_evolution.ga.evolution import Evolution, EvolutionConfig
from wordle_evolution.utils.seed import make_rng
from wordle_evolution.wordle.types import FEATURE_ORDER


def _chrom(weights, mr=0.5):
    return Chromosome(id="c", weights=weights, mutation_rate=mr, generation_born=0)


def test_mutation_changes_at_least_one_weight_and_clamps():
    rng = make_rng("mut", "t")
    base = _chrom({f: 0.0 for f in FEATURE_ORDER}, mr=1.0)
    child = mutate(base, rng, large_mutation_chance=0.5)
    changed = any(child.weights[f] != base.weights[f] for f in FEATURE_ORDER)
    assert changed
    for f in FEATURE_ORDER:
        assert WEIGHT_MIN <= child.weights[f] <= WEIGHT_MAX


def test_mutation_respects_clamp_from_extreme():
    rng = make_rng("mut2", "t")
    base = _chrom({f: WEIGHT_MAX for f in FEATURE_ORDER}, mr=1.0)
    child = mutate(base, rng, large_mutation_chance=1.0, large_sigma=50.0)
    for f in FEATURE_ORDER:
        assert child.weights[f] <= WEIGHT_MAX
        assert child.weights[f] >= WEIGHT_MIN


def test_uniform_crossover_inherits_from_parents():
    rng = make_rng("cx", "t")
    a = {f: 1.0 for f in FEATURE_ORDER}
    b = {f: -1.0 for f in FEATURE_ORDER}
    child = _uniform_child_weights(a, b, rng)
    for f in FEATURE_ORDER:
        assert child[f] in (1.0, -1.0)


def test_blend_crossover_stays_in_interval():
    rng = make_rng("blend", "t")
    a = {f: 2.0 for f in FEATURE_ORDER}
    b = {f: 6.0 for f in FEATURE_ORDER}
    child = _blend_child_weights(a, b, rng, alpha=0.3)
    # BLX-0.3 over [2,6]: interval is [2 - 1.2, 6 + 1.2] = [0.8, 7.2].
    for f in FEATURE_ORDER:
        assert 0.8 - 1e-9 <= child[f] <= 7.2 + 1e-9


def test_crossover_child_metadata():
    rng = make_rng("cxmeta", "t")
    a = _chrom({f: 1.0 for f in FEATURE_ORDER}, mr=0.2)
    a.species = "Balanced Bot"
    b = _chrom({f: -1.0 for f in FEATURE_ORDER}, mr=0.4)
    child = crossover(a, b, rng, "child-1", 3)
    assert child.id == "child-1"
    assert child.generation_born == 3
    assert child.species == "Balanced Bot"
    assert abs(child.mutation_rate - 0.3) < 1e-9


def test_tournament_selection_returns_fittest():
    population = [f"i{i}" for i in range(6)]
    fitnesses = [10.0, 5.0, 99.0, 1.0, 2.0, 3.0]  # index 2 is best
    rng = make_rng("tour", "t")
    # Full-size tournament must always return the global best.
    assert tournament_select(population, fitnesses, len(population), rng) == "i2"


def test_tournament_selection_is_seeded_reproducible():
    population = [f"i{i}" for i in range(8)]
    fitnesses = [float(i) for i in range(8)]
    r1 = make_rng("s", "sel")
    r2 = make_rng("s", "sel")
    picks1 = [tournament_select(population, fitnesses, 3, r1) for _ in range(20)]
    picks2 = [tournament_select(population, fitnesses, 3, r2) for _ in range(20)]
    assert picks1 == picks2


def _small_config(seed="det-test"):
    return EvolutionConfig(
        population_size=12,
        generations=3,
        elite_count=2,
        tournament_size=3,
        training_sample_size=20,
        validation_sample_size=20,
        seed=seed,
        pool_cap=40,
        opener_pool_cap=50,
        entropy_subsample_cap=16,
    )


def test_evolution_is_deterministic():
    ev1 = Evolution(_small_config())
    ev2 = Evolution(_small_config())
    h1 = ev1.run_evolution()
    h2 = ev2.run_evolution()

    assert len(h1) == len(h2) == 3
    # Identical champion weights and fitness trajectory.
    assert h1[-1].champion.chromosome.weights == h2[-1].champion.chromosome.weights
    assert [r.best_fitness for r in h1] == [r.best_fitness for r in h2]
    assert [r.avg_fitness for r in h1] == [r.avg_fitness for r in h2]


def test_initial_population_has_seeded_species():
    ev = Evolution(_small_config())
    pop = ev.initialize_population()
    assert len(pop) == 12
    species = {c.species for c in pop if c.species}
    assert "Balanced Bot" in species
    assert "Entropy Enjoyer" in species


def test_random_weights_within_bounds():
    rng = make_rng("rw", "t")
    w = random_weights(rng)
    assert set(w.keys()) == set(FEATURE_ORDER)
    for v in w.values():
        assert WEIGHT_MIN <= v <= WEIGHT_MAX
