// The genetic algorithm loop.
//
// Each call to step():
//   1. samples a fresh set of hidden answers (same for every chromosome this
//      generation — common random numbers => fair, low-variance comparison),
//   2. evaluates every chromosome and scores its fitness,
//   3. builds a GenerationReport (champion, diversity, per-member summary),
//   4. breeds the next generation (elitism + tournament + crossover + mutation
//      + clone protection).
//
// Every stochastic choice flows through a per-(purpose, generation) seeded
// stream, so the SAME config + seed reproduces an identical run.

import { EngineContext, evaluateChromosomeStats } from '../engine/evaluate';
import { makeScratch, PlayerScratch } from '../engine/player';
import { streamFor } from '../engine/seedRandom';
import { Chromosome, ChromosomeStats, EvolutionConfig } from '../engine/types';
import {
  cloneChromosome,
  cosineDistance,
  createRandomChromosome,
  nickname,
  populationDiversity,
  seededChampions,
} from './chromosome';
import { crossover } from './crossover';
import { computeFitness } from './fitness';
import { mutate } from './mutation';
import { tournamentSelect } from './selection';

export interface PopulationMember {
  id: string;
  fitness: number;
  winRate: number;
  avgGuesses: number;
  mutationRate: number;
  generationBorn: number;
  distanceFromChampion: number;
  nickname: string;
}

export interface ChampionInfo {
  chromosome: Chromosome;
  fitness: number;
  stats: ChromosomeStats;
  nickname: string;
}

export interface GenerationReport {
  generation: number; // 0-based index of the population that was evaluated
  evaluations: number; // cumulative games played across the run
  bestFitness: number;
  avgFitness: number;
  medianFitness: number;
  winRate: number; // champion win rate
  avgGuesses: number; // champion avg guesses
  diversityScore: number;
  champion: ChampionInfo;
  population: PopulationMember[];
  elapsedMs: number;
}

export class Evolution {
  readonly ctx: EngineContext;
  config: EvolutionConfig;
  population: Chromosome[] = [];
  generation = 0;

  private scratch: PlayerScratch;
  private idCounter = 0;
  private totalEvaluations = 0;
  private bestFitnessHistory: number[] = [];
  private allIndices: Int32Array;
  private sampleBuf: Int32Array;

  constructor(ctx: EngineContext, config: EvolutionConfig) {
    this.ctx = ctx;
    this.config = config;
    this.scratch = makeScratch(ctx.caps.poolCap, ctx.answerCount, ctx.guessCount);
    this.allIndices = new Int32Array(ctx.answerCount);
    for (let i = 0; i < ctx.answerCount; i++) this.allIndices[i] = i;
    this.sampleBuf = new Int32Array(Math.min(config.trainingSampleSize, ctx.answerCount));
    this.init();
  }

  /** Seed the initial population: the hand-designed champions + random fill. */
  init(): void {
    const rng = streamFor(this.config.seed, 'init', 0);
    const pop: Chromosome[] = seededChampions(0, this.config.mutationRate);
    while (pop.length < this.config.populationSize) {
      pop.push(
        createRandomChromosome(
          rng,
          0,
          this.nextId(0),
          this.config.mutationRate,
          this.config.weightClampMin,
          this.config.weightClampMax,
        ),
      );
    }
    this.population = pop.slice(0, this.config.populationSize);
    this.generation = 0;
    this.idCounter = 0;
    this.totalEvaluations = 0;
    this.bestFitnessHistory = [];
  }

  private nextId(gen: number): string {
    return `g${gen}#${this.idCounter++}`;
  }

  /** Deterministically sample this generation's hidden answers. */
  private sampleAnswers(gen: number): { indices: Int32Array; count: number } {
    const rng = streamFor(this.config.seed, 'answers', gen);
    const A = this.ctx.answerCount;
    const k = Math.min(this.config.trainingSampleSize, A);
    for (let i = 0; i < k; i++) {
      const j = i + rng.int(A - i);
      const tmp = this.allIndices[i];
      this.allIndices[i] = this.allIndices[j];
      this.allIndices[j] = tmp;
      this.sampleBuf[i] = this.allIndices[i];
    }
    return { indices: this.sampleBuf, count: k };
  }

  /** Evaluate the current population and produce one generation report. */
  step(): GenerationReport {
    const gen = this.generation;
    const { indices, count } = this.sampleAnswers(gen);

    const n = this.population.length;
    const fitness = new Float64Array(n);
    const stats: ChromosomeStats[] = new Array(n);

    let bestIndex = 0;
    let bestFitness = -Infinity;
    let sumFitness = 0;

    for (let i = 0; i < n; i++) {
      const s = evaluateChromosomeStats(this.ctx, this.population[i], this.scratch, indices, count);
      const f = computeFitness(s, this.config.fitness);
      stats[i] = s;
      fitness[i] = f;
      sumFitness += f;
      if (f > bestFitness) {
        bestFitness = f;
        bestIndex = i;
      }
    }
    this.totalEvaluations += n * count;

    const championChromo = this.population[bestIndex];
    const champion: ChampionInfo = {
      chromosome: cloneChromosome(championChromo),
      fitness: bestFitness,
      stats: stats[bestIndex],
      nickname: nickname(championChromo),
    };

    const members: PopulationMember[] = this.population.map((c, i) => ({
      id: c.id,
      fitness: fitness[i],
      winRate: stats[i].winRate,
      avgGuesses: stats[i].avgGuesses,
      mutationRate: c.mutationRate,
      generationBorn: c.generationBorn,
      distanceFromChampion: cosineDistance(c.weights, championChromo.weights),
      nickname: nickname(c),
    }));

    const sorted = Float64Array.from(fitness).sort();
    const medianFitness =
      n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

    const report: GenerationReport = {
      generation: gen,
      evaluations: this.totalEvaluations,
      bestFitness,
      avgFitness: sumFitness / n,
      medianFitness,
      winRate: stats[bestIndex].winRate,
      avgGuesses: stats[bestIndex].avgGuesses,
      diversityScore: populationDiversity(this.population),
      champion,
      population: members,
      elapsedMs: 0,
    };

    this.bestFitnessHistory.push(bestFitness);
    this.population = this.breed(fitness);
    this.generation++;

    return report;
  }

  /** Build the next generation from fitness-scored current population. */
  private breed(fitness: Float64Array): Chromosome[] {
    const gen = this.generation; // parents belong to this generation
    const childGen = gen + 1;
    const selectRng = streamFor(this.config.seed, 'select', gen);
    const crossRng = streamFor(this.config.seed, 'cross', gen);
    const mutateRng = streamFor(this.config.seed, 'mutate', gen);

    const order = Array.from({ length: this.population.length }, (_, i) => i).sort(
      (a, b) => fitness[b] - fitness[a],
    );

    const next: Chromosome[] = [];
    // Elitism: carry the best individuals through untouched.
    for (let i = 0; i < this.config.eliteCount && i < order.length; i++) {
      next.push(cloneChromosome(this.population[order[i]]));
    }

    while (next.length < this.config.populationSize) {
      const parentA = tournamentSelect(this.population, fitness, this.config.tournamentSize, selectRng);
      const parentB = tournamentSelect(this.population, fitness, this.config.tournamentSize, selectRng);
      const [c1, c2] = crossover(
        parentA,
        parentB,
        crossRng,
        { crossoverRate: this.config.crossoverRate, blendAlpha: this.config.blendAlpha },
        childGen,
        this.nextId(childGen),
        this.nextId(childGen),
      );
      for (const child of [c1, c2]) {
        if (next.length >= this.config.populationSize) break;
        next.push(this.protectAgainstClones(mutateRng, child, next));
      }
    }

    return next;
  }

  /** Mutate a child; if it's a near-clone of an accepted member, mutate harder
   * (and, if still too close, replace it with a fresh random individual). */
  private protectAgainstClones(
    mutateRng: ReturnType<typeof streamFor>,
    child: Chromosome,
    accepted: Chromosome[],
  ): Chromosome {
    const mutationConfig = {
      mutationSigma: this.config.mutationSigma,
      largeMutationChance: this.config.largeMutationChance,
      largeMutationSigma: this.config.largeMutationSigma,
      clampMin: this.config.weightClampMin,
      clampMax: this.config.weightClampMax,
    };

    let mutated = mutate(child, mutateRng, mutationConfig);
    if (this.nearestDistance(mutated, accepted) >= this.config.cloneCosineEps) return mutated;

    // Too similar — give it another shove.
    mutated = mutate(mutated, mutateRng, mutationConfig);
    if (this.nearestDistance(mutated, accepted) >= this.config.cloneCosineEps) return mutated;

    // Still a clone — inject fresh blood to protect diversity.
    return createRandomChromosome(
      mutateRng,
      mutated.generationBorn,
      mutated.id,
      this.config.mutationRate,
      this.config.weightClampMin,
      this.config.weightClampMax,
    );
  }

  private nearestDistance(c: Chromosome, others: Chromosome[]): number {
    let min = Infinity;
    for (const o of others) {
      const d = cosineDistance(c.weights, o.weights);
      if (d < min) min = d;
    }
    return min === Infinity ? 1 : min;
  }

  /** Whether the run should stop (independent of manual/generation-count stop). */
  terminationReason(): 'fixed' | 'plateau' | null {
    if (this.generation >= this.config.generations) return 'fixed';
    if (this.config.terminationMode === 'plateau') {
      const window = this.config.plateauGenerations;
      const hist = this.bestFitnessHistory;
      if (hist.length > window) {
        const recent = hist.slice(-window - 1);
        const improvement = recent[recent.length - 1] - recent[0];
        if (improvement < this.config.plateauEpsilon) return 'plateau';
      }
    }
    return null;
  }
}
