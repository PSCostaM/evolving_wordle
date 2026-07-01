import { beforeAll, describe, expect, it } from 'vitest';
import { ANSWERS } from '../data/answers';
import { GUESSES } from '../data/guesses';
import { buildEngineContext, EngineContext, evaluateChromosomeStats } from '../engine/evaluate';
import { DEFAULT_CONFIG, EvolutionConfig, FEATURE_ORDER, weightsToArray } from '../engine/types';
import { Rng } from '../engine/seedRandom';
import { createRandomChromosome, presetChromosome } from '../ga/chromosome';
import { mutate } from '../ga/mutation';
import { crossover } from '../ga/crossover';
import { computeFitness } from '../ga/fitness';
import { Evolution } from '../ga/evolution';

// A small but real engine context so tests stay fast.
let ctx: EngineContext;

beforeAll(() => {
  const answers = [...ANSWERS].slice(0, 80);
  const guesses = Array.from(new Set([...answers, ...GUESSES.slice(0, 400)])).sort();
  ctx = buildEngineContext(answers, guesses, { fastMode: true, useEntropy: true, maxTurns: 6 });
});

const testConfig = (): EvolutionConfig => ({
  ...DEFAULT_CONFIG,
  populationSize: 14,
  trainingSampleSize: 20,
  generations: 4,
  eliteCount: 2,
  tournamentSize: 4,
  seed: 'unit-test-seed',
});

describe('chromosome creation', () => {
  it('creates a chromosome with all 12 weights inside the clamp range', () => {
    const rng = new Rng(1234);
    const c = createRandomChromosome(rng, 0, 'c0', 0.15, -10, 10);
    expect(Object.keys(c.weights).sort()).toEqual([...FEATURE_ORDER].sort());
    for (const f of FEATURE_ORDER) {
      expect(c.weights[f]).toBeGreaterThanOrEqual(-10);
      expect(c.weights[f]).toBeLessThanOrEqual(10);
    }
    expect(c.mutationRate).toBeGreaterThan(0);
    expect(c.generationBorn).toBe(0);
  });
});

describe('mutation', () => {
  it('changes at least some weights and respects the clamp', () => {
    const rng = new Rng(99);
    const parent = createRandomChromosome(new Rng(7), 0, 'p', 0.2, -10, 10);
    const child = mutate(parent, rng, {
      mutationSigma: 0.9,
      largeMutationChance: 0.05,
      largeMutationSigma: 4,
      clampMin: -10,
      clampMax: 10,
    });

    let changed = 0;
    for (const f of FEATURE_ORDER) {
      if (child.weights[f] !== parent.weights[f]) changed++;
      expect(child.weights[f]).toBeGreaterThanOrEqual(-10);
      expect(child.weights[f]).toBeLessThanOrEqual(10);
    }
    expect(changed).toBeGreaterThan(0);
  });
});

describe('crossover', () => {
  it('produces children whose genes are derived from both parents', () => {
    const alpha = 0.35;
    // Parent A = all zeros, Parent B = all fives.
    const a = presetChromosome('balanced');
    const b = presetChromosome('balanced');
    for (const f of FEATURE_ORDER) {
      a.weights[f] = 0;
      b.weights[f] = 5;
    }

    const rng = new Rng(2024);
    const [c1, c2] = crossover(a, b, rng, { crossoverRate: 1, blendAlpha: alpha }, 1, 'x1', 'x2');

    // BLX-α keeps every gene within [min - α·range, max + α·range] = [-1.75, 6.75].
    for (const child of [c1, c2]) {
      for (const f of FEATURE_ORDER) {
        expect(child.weights[f]).toBeGreaterThanOrEqual(-1.75 - 1e-9);
        expect(child.weights[f]).toBeLessThanOrEqual(6.75 + 1e-9);
      }
    }
  });
});

describe('fitness evaluation', () => {
  it('returns sensible, finite values for a seeded champion', () => {
    const scratch = ctx.explainScratch;
    const indices = Int32Array.from({ length: 20 }, (_, i) => i);
    const stats = evaluateChromosomeStats(ctx, presetChromosome('entropy'), scratch, indices, 20);

    expect(stats.winRate).toBeGreaterThanOrEqual(0);
    expect(stats.winRate).toBeLessThanOrEqual(1);
    expect(stats.avgGuesses).toBeGreaterThanOrEqual(1);
    expect(stats.avgGuesses).toBeLessThanOrEqual(6);
    expect(Number.isFinite(computeFitness(stats, DEFAULT_CONFIG.fitness))).toBe(true);
    // A reasonable heuristic should beat coin-flip win rates on easy words.
    expect(stats.winRate).toBeGreaterThan(0.5);
  });
});

describe('determinism', () => {
  it('produces identical generation reports for the same seed', () => {
    const runOnce = () => {
      const evo = new Evolution(ctx, testConfig());
      const best: number[] = [];
      const win: number[] = [];
      for (let g = 0; g < 4; g++) {
        const report = evo.step();
        best.push(report.bestFitness);
        win.push(report.winRate);
      }
      return { best, win };
    };

    const a = runOnce();
    const b = runOnce();
    expect(a.best).toEqual(b.best);
    expect(a.win).toEqual(b.win);
  });

  it('never regresses best fitness when the answer sample is fixed (elitism)', () => {
    // With trainingSampleSize >= answerCount, every generation faces the SAME
    // answer set, so an untouched elite keeps its exact fitness => the best can
    // only stay flat or improve. (With resampling, per-gen best is noisy.)
    const evo = new Evolution(ctx, { ...testConfig(), trainingSampleSize: ctx.answerCount });
    let prevBest = -Infinity;
    let nonDecreasing = true;
    for (let g = 0; g < 4; g++) {
      const report = evo.step();
      if (report.bestFitness < prevBest - 1e-6) nonDecreasing = false;
      prevBest = report.bestFitness;
    }
    expect(nonDecreasing).toBe(true);
    expect(weightsToArray(evo.population[0].weights).length).toBe(12);
  });
});
