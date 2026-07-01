// Crossover: combine two parents into two children.
//
// Per child we randomly pick ONE of two schemes:
//   * uniform   — each gene comes from parent A or B (coin flip)
//   * blend     — arithmetic BLX-α: gene = a + t·(b − a), t ∈ [−α, 1+α]
// With probability (1 − crossoverRate) the child is just a copy of a parent
// (it will still be mutated afterwards).

import { Rng } from '../engine/seedRandom';
import { Chromosome, FEATURE_ORDER, FeatureWeights } from '../engine/types';

export interface CrossoverConfig {
  crossoverRate: number;
  blendAlpha: number;
}

export function crossover(
  parentA: Chromosome,
  parentB: Chromosome,
  rng: Rng,
  config: CrossoverConfig,
  generationBorn: number,
  idA: string,
  idB: string,
): [Chromosome, Chromosome] {
  return [
    makeChild(parentA, parentB, rng, config, generationBorn, idA),
    makeChild(parentB, parentA, rng, config, generationBorn, idB),
  ];
}

function makeChild(
  primary: Chromosome,
  other: Chromosome,
  rng: Rng,
  config: CrossoverConfig,
  generationBorn: number,
  id: string,
): Chromosome {
  const weights = {} as FeatureWeights;

  if (rng.next() > config.crossoverRate) {
    // No crossover: copy the primary parent.
    for (const f of FEATURE_ORDER) weights[f] = primary.weights[f];
    return { id, weights, mutationRate: primary.mutationRate, generationBorn };
  }

  const useBlend = rng.next() < 0.5;
  for (const f of FEATURE_ORDER) {
    const a = primary.weights[f];
    const b = other.weights[f];
    if (useBlend) {
      const t = rng.float(-config.blendAlpha, 1 + config.blendAlpha);
      weights[f] = a + t * (b - a);
    } else {
      weights[f] = rng.next() < 0.5 ? a : b;
    }
  }

  // Children inherit a blended mutation rate.
  const mutationRate = (primary.mutationRate + other.mutationRate) / 2;
  return { id, weights, mutationRate, generationBorn };
}
