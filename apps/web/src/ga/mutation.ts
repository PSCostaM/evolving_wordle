// Mutation: jitter the weights, occasionally kick one hard, and self-adapt the
// mutation rate. Weights are clamped to a safe range so the search can't run
// off to infinity.

import { Rng } from '../engine/seedRandom';
import { Chromosome, FEATURE_ORDER, FeatureWeights } from '../engine/types';

export interface MutationConfig {
  mutationSigma: number; // base gaussian scale
  largeMutationChance: number; // probability of a big kick per gene
  largeMutationSigma: number; // scale of the big kick
  clampMin: number;
  clampMax: number;
}

/** Return a mutated COPY of the chromosome. */
export function mutate(c: Chromosome, rng: Rng, config: MutationConfig): Chromosome {
  const weights = {} as FeatureWeights;

  // Self-adapt the mutation rate (log-normal step), clamped to a sane band.
  const nextRate = clamp(c.mutationRate * Math.exp(0.2 * rng.gaussian()), 0.01, 1);

  for (const f of FEATURE_ORDER) {
    let value = c.weights[f];
    // Ordinary gaussian jitter, magnitude scaled by the (self-adapted) rate.
    value += rng.gaussian() * config.mutationSigma * nextRate;
    // Occasional large mutation to escape local optima.
    if (rng.next() < config.largeMutationChance) {
      value += rng.gaussian() * config.largeMutationSigma;
    }
    weights[f] = clamp(value, config.clampMin, config.clampMax);
  }

  return { id: c.id, weights, mutationRate: nextRate, generationBorn: c.generationBorn };
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
