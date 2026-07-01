"""The genetic-algorithm driver: population evolution with elitism & diversity.

Everything is deterministic given ``EvolutionConfig.seed`` — all randomness is
drawn from :mod:`wordle_evolution.utils.seed` keyed by purpose and generation.
"""

from __future__ import annotations

import statistics
from concurrent.futures import Executor, as_completed
from dataclasses import dataclass, field
from typing import Callable, Iterator, Optional

from ..features.feature_extractor import FeatureConfig, PlayerConfig
from ..utils.seed import make_rng
from ..utils.timing import Stopwatch
from ..wordle.words import ANSWERS, GUESSES
from .chromosome import Chromosome, cosine_distance, nickname
from .crossover import crossover
from .fitness import (
    ChromosomeStats,
    FitnessConfig,
    FitnessResult,
    evaluate_chromosome,
)
from .mutation import mutate
from .population import initialize_population
from .selection import tournament_select

# Called after each chromosome in a generation is scored: (done, total).
ProgressFn = Callable[[int, int], None]


def _eval_worker(payload):
    """Score one chromosome in a worker process.

    Kept module-level (so it pickles) and pulls the big ``GUESSES`` list from the
    worker's own module globals instead of shipping ~13k words across the process
    boundary on every task. Returns just ``(fitness, stats)`` — the parent already
    holds the chromosome, so there's no need to round-trip it back.
    """
    from ..wordle.words import GUESSES as WORKER_GUESSES
    from .fitness import evaluate_chromosome as _eval

    chromosome, sample, player_config, fitness_config, seed = payload
    result = _eval(
        chromosome,
        sample,
        WORKER_GUESSES,
        player_config,
        seed=seed,
        fitness_config=fitness_config,
    )
    return result.fitness, result.stats


# --------------------------------------------------------------------------- #
# Config & report structures
# --------------------------------------------------------------------------- #
@dataclass
class EvolutionConfig:
    population_size: int = 80
    generations: int = 100
    elite_count: int = 8
    tournament_size: int = 5
    mutation_rate: float = 0.15
    large_mutation_chance: float = 0.03
    training_sample_size: int = 150
    validation_sample_size: int = 150
    seed: str = "codebullet-wordle"
    use_entropy: bool = True
    max_turns: int = 6
    fitness_config: FitnessConfig = field(default_factory=FitnessConfig)
    # Player pool caps (kept small in tests for speed).
    pool_cap: int = 200
    opener_pool_cap: int = 300
    entropy_subsample_cap: int = 64
    blend_alpha: float = 0.3

    def player_config(self) -> PlayerConfig:
        return PlayerConfig(
            max_turns=self.max_turns,
            use_entropy=self.use_entropy,
            pool_cap=self.pool_cap,
            opener_pool_cap=self.opener_pool_cap,
            entropy_subsample_cap=self.entropy_subsample_cap,
            feature_config=FeatureConfig(),
        )


@dataclass
class ChampionRecord:
    chromosome: Chromosome
    fitness: float
    stats: ChromosomeStats
    nickname: str


@dataclass
class PopulationMember:
    id: str
    fitness: float
    win_rate: float
    avg_guesses: float
    mutation_rate: float
    generation_born: int
    distance_from_champion: float
    nickname: str


@dataclass
class GenerationReport:
    generation: int
    evaluations: int
    best_fitness: float
    avg_fitness: float
    median_fitness: float
    win_rate: float
    avg_guesses: float
    diversity_score: float
    champion: ChampionRecord
    population: list[PopulationMember]
    elapsed_ms: int


# --------------------------------------------------------------------------- #
# Evolution driver
# --------------------------------------------------------------------------- #
class Evolution:
    def __init__(
        self,
        config: EvolutionConfig | None = None,
        answers=ANSWERS,
        valid_guesses=GUESSES,
    ) -> None:
        self.config = config or EvolutionConfig()
        self.answers = list(answers)
        self.valid_guesses = list(valid_guesses)
        self.player_config = self.config.player_config()

        self.population: list[Chromosome] = []
        self.generation: int = 0  # index of the next generation to evaluate
        self.history: list[GenerationReport] = []
        self.best_overall: ChampionRecord | None = None
        self._evaluations = 0

    # -- population setup --------------------------------------------------- #
    def initialize_population(self) -> list[Chromosome]:
        self.population = initialize_population(
            self.config.population_size,
            self.config.seed,
            base_mutation_rate=self.config.mutation_rate,
            generation=0,
        )
        return self.population

    def sample_answers(self, generation: int) -> list[str]:
        """Deterministically sample the shared per-generation training answers."""
        k = min(self.config.training_sample_size, len(self.answers))
        rng = make_rng(self.config.seed, "train_sample", generation)
        return rng.sample(self.answers, k)

    # -- evaluation --------------------------------------------------------- #
    def evaluate_population(
        self,
        population: list[Chromosome],
        sample: list[str],
        on_progress: Optional[ProgressFn] = None,
        executor: Optional[Executor] = None,
    ) -> list[FitnessResult]:
        """Score every chromosome against the shared answer ``sample``.

        With an ``executor`` (a process pool), chromosomes are scored concurrently
        — they're fully independent, so results are folded back by their original
        index and stay bit-for-bit identical to the serial path. ``on_progress`` is
        invoked as ``(done, total)`` after each chromosome finishes, driving the
        live per-generation progress bar.
        """
        total = len(population)

        if executor is None:
            results: list[FitnessResult] = []
            for chrom in population:
                results.append(
                    evaluate_chromosome(
                        chrom,
                        sample,
                        self.valid_guesses,
                        self.player_config,
                        seed=self.config.seed,
                        fitness_config=self.config.fitness_config,
                    )
                )
                self._evaluations += 1
                if on_progress is not None:
                    on_progress(len(results), total)
            return results

        # Parallel path: submit one task per chromosome, collect out-of-order but
        # store each result at its original index to preserve determinism.
        indexed: list[Optional[FitnessResult]] = [None] * total
        futures = {
            executor.submit(
                _eval_worker,
                (
                    chrom,
                    sample,
                    self.player_config,
                    self.config.fitness_config,
                    self.config.seed,
                ),
            ): i
            for i, chrom in enumerate(population)
        }
        done = 0
        for future in as_completed(futures):
            i = futures[future]
            fitness, stats = future.result()
            indexed[i] = FitnessResult(chromosome=population[i], fitness=fitness, stats=stats)
            self._evaluations += 1
            done += 1
            if on_progress is not None:
                on_progress(done, total)
        return [r for r in indexed if r is not None]

    # -- selection / variation --------------------------------------------- #
    def select_parents(
        self, population: list[Chromosome], fitnesses: list[float], rng
    ) -> tuple[Chromosome, Chromosome]:
        a = tournament_select(population, fitnesses, self.config.tournament_size, rng)
        b = tournament_select(population, fitnesses, self.config.tournament_size, rng)
        return a, b

    def crossover(self, a: Chromosome, b: Chromosome, rng, child_id: str, generation: int) -> Chromosome:
        return crossover(a, b, rng, child_id, generation, blend_alpha=self.config.blend_alpha)

    def mutate(self, chromosome: Chromosome, rng) -> Chromosome:
        return mutate(
            chromosome,
            rng,
            large_mutation_chance=self.config.large_mutation_chance,
        )

    # -- next generation ---------------------------------------------------- #
    def next_generation(
        self, population: list[Chromosome], results: list[FitnessResult], generation: int
    ) -> list[Chromosome]:
        """Build the next generation: elitism + selection + crossover + mutation.

        Includes clone protection (near-duplicate children get an extra mutation).
        """
        rng = make_rng(self.config.seed, "reproduce", generation)
        order = sorted(range(len(population)), key=lambda i: results[i].fitness, reverse=True)
        ranked = [population[i] for i in order]
        fitnesses = [results[i].fitness for i in order]

        elite_count = min(self.config.elite_count, len(ranked))
        next_pop: list[Chromosome] = []
        # Elites carried over unchanged (genes preserved, re-evaluated next gen).
        for e in range(elite_count):
            elite = ranked[e]
            next_pop.append(elite.copy_with())

        child_index = 0
        next_gen_number = generation + 1
        while len(next_pop) < self.config.population_size:
            parent_a, parent_b = self.select_parents(ranked, fitnesses, rng)
            child_id = f"g{next_gen_number}-c{child_index}"
            child = self.crossover(parent_a, parent_b, rng, child_id, next_gen_number)
            child = self.mutate(child, rng)

            # Clone protection: if near-identical to an accepted member, re-mutate.
            for _ in range(3):
                if not self._is_clone(child, next_pop):
                    break
                child = self.mutate(child, rng)
            next_pop.append(child)
            child_index += 1

        return next_pop[: self.config.population_size]

    @staticmethod
    def _is_clone(child: Chromosome, others: list[Chromosome], eps: float = 1e-3) -> bool:
        for other in others:
            if cosine_distance(child.weights, other.weights) < eps:
                return True
        return False

    # -- reporting ---------------------------------------------------------- #
    def _build_report(
        self,
        generation: int,
        population: list[Chromosome],
        results: list[FitnessResult],
        elapsed_ms: int,
    ) -> GenerationReport:
        fitnesses = [r.fitness for r in results]
        best_idx = max(range(len(results)), key=lambda i: results[i].fitness)
        champ_result = results[best_idx]
        champ_chrom = population[best_idx]
        champion = ChampionRecord(
            chromosome=champ_chrom,
            fitness=champ_result.fitness,
            stats=champ_result.stats,
            nickname=nickname(champ_chrom),
        )

        members: list[PopulationMember] = []
        for chrom, res in zip(population, results):
            members.append(
                PopulationMember(
                    id=chrom.id,
                    fitness=res.fitness,
                    win_rate=res.stats.win_rate,
                    avg_guesses=res.stats.avg_guesses,
                    mutation_rate=chrom.mutation_rate,
                    generation_born=chrom.generation_born,
                    distance_from_champion=cosine_distance(chrom.weights, champ_chrom.weights),
                    nickname=nickname(chrom),
                )
            )

        return GenerationReport(
            generation=generation,
            evaluations=self._evaluations,
            best_fitness=max(fitnesses),
            avg_fitness=statistics.fmean(fitnesses),
            median_fitness=statistics.median(fitnesses),
            win_rate=champ_result.stats.win_rate,
            avg_guesses=champ_result.stats.avg_guesses,
            diversity_score=self._diversity(population),
            champion=champion,
            population=members,
            elapsed_ms=elapsed_ms,
        )

    @staticmethod
    def _diversity(population: list[Chromosome]) -> float:
        n = len(population)
        if n < 2:
            return 0.0
        total = 0.0
        pairs = 0
        for i in range(n):
            wi = population[i].weights
            for j in range(i + 1, n):
                total += cosine_distance(wi, population[j].weights)
                pairs += 1
        return total / pairs if pairs else 0.0

    # -- stepping ----------------------------------------------------------- #
    def step(
        self,
        on_progress: Optional[ProgressFn] = None,
        executor: Optional[Executor] = None,
    ) -> GenerationReport:
        """Evaluate one generation and prepare the next. Returns its report.

        ``on_progress(done, total)`` fires as each chromosome is scored; passing an
        ``executor`` scores the population in parallel across processes.
        """
        if self.generation == 0 and not self.population:
            self.initialize_population()

        watch = Stopwatch()
        generation = self.generation
        sample = self.sample_answers(generation)
        results = self.evaluate_population(
            self.population, sample, on_progress=on_progress, executor=executor
        )
        report = self._build_report(generation, self.population, results, watch.elapsed_ms())
        self.history.append(report)

        if self.best_overall is None or report.champion.fitness > self.best_overall.fitness:
            self.best_overall = report.champion

        # Prepare the next generation (skipped after the final one is irrelevant).
        self.population = self.next_generation(self.population, results, generation)
        self.generation += 1
        return report

    def is_done(self) -> bool:
        return self.generation >= self.config.generations

    def run_evolution(
        self,
        on_generation: Callable[[GenerationReport], None] | None = None,
    ) -> list[GenerationReport]:
        """Run all generations, invoking ``on_generation`` after each. Deterministic."""
        while not self.is_done():
            report = self.step()
            if on_generation is not None:
                on_generation(report)
        return self.history

    def iter_evolution(self) -> Iterator[GenerationReport]:
        """Generator yielding one report per generation (for cooperative loops)."""
        while not self.is_done():
            yield self.step()
