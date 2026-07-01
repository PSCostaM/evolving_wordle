// Chromosomes: the evolvable individuals.
//
// A chromosome is a bag of numeric weights (one per heuristic feature), a
// self-adaptive mutationRate, and some bookkeeping. Everything else in the GA
// operates on these.

import { Rng } from '../engine/seedRandom';
import {
  Chromosome,
  FEATURE_ORDER,
  FeatureName,
  FeatureWeights,
  weightsToArray,
} from '../engine/types';

/** Build a zeroed weights object. */
export function zeroWeights(): FeatureWeights {
  const w = {} as FeatureWeights;
  for (const f of FEATURE_ORDER) w[f] = 0;
  return w;
}

/** Random weights uniformly across the clamp range. */
export function randomWeights(rng: Rng, min: number, max: number): FeatureWeights {
  const w = {} as FeatureWeights;
  for (const f of FEATURE_ORDER) w[f] = rng.float(min, max);
  return w;
}

export function createRandomChromosome(
  rng: Rng,
  generationBorn: number,
  id: string,
  baseMutationRate: number,
  clampMin: number,
  clampMax: number,
): Chromosome {
  return {
    id,
    weights: randomWeights(rng, clampMin, clampMax),
    mutationRate: clamp(baseMutationRate * rng.float(0.6, 1.6), 0.01, 1),
    generationBorn,
  };
}

export function cloneChromosome(c: Chromosome, id?: string): Chromosome {
  return {
    id: id ?? c.id,
    weights: { ...c.weights },
    mutationRate: c.mutationRate,
    generationBorn: c.generationBorn,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

// ---------------------------------------------------------------------------
// Seeded champion presets — hand-designed starting points so evolution has some
// good genes to recombine (and so the baseline comparison has real opponents).
// ---------------------------------------------------------------------------

export type PresetKey = 'entropy' | 'frequency' | 'candidate' | 'balanced';

export const CHAMPION_PRESETS: Record<PresetKey, { name: string; weights: FeatureWeights }> = {
  entropy: {
    name: 'Entropy enjoyer',
    weights: mk({
      candidateBonus: 3,
      entropyScore: 9,
      expectedRemainingPenalty: -6,
      letterFrequencyScore: 1,
      positionalFrequencyScore: 1,
      uniqueLetterBonus: 1,
      duplicateLetterPenalty: -2,
      vowelCoverageScore: 0.5,
      knownGreenBonus: 3,
      knownYellowBonus: 2,
      knownAbsentPenalty: -3,
      endgameCandidatePressure: 5,
    }),
  },
  frequency: {
    name: 'Frequency fiend',
    weights: mk({
      candidateBonus: 3,
      entropyScore: 0,
      expectedRemainingPenalty: 0,
      letterFrequencyScore: 7,
      positionalFrequencyScore: 8,
      uniqueLetterBonus: 3,
      duplicateLetterPenalty: -3,
      vowelCoverageScore: 3,
      knownGreenBonus: 4,
      knownYellowBonus: 3,
      knownAbsentPenalty: -4,
      endgameCandidatePressure: 6,
    }),
  },
  candidate: {
    name: 'Candidate sniper',
    weights: mk({
      candidateBonus: 8,
      entropyScore: 1,
      expectedRemainingPenalty: -1,
      letterFrequencyScore: 2,
      positionalFrequencyScore: 2,
      uniqueLetterBonus: 1,
      duplicateLetterPenalty: -1,
      vowelCoverageScore: 1,
      knownGreenBonus: 4,
      knownYellowBonus: 3,
      knownAbsentPenalty: -3,
      endgameCandidatePressure: 9,
    }),
  },
  balanced: {
    name: 'The balanced one',
    weights: mk({
      candidateBonus: 4,
      entropyScore: 5,
      expectedRemainingPenalty: -3,
      letterFrequencyScore: 4,
      positionalFrequencyScore: 4,
      uniqueLetterBonus: 2,
      duplicateLetterPenalty: -2,
      vowelCoverageScore: 2,
      knownGreenBonus: 4,
      knownYellowBonus: 3,
      knownAbsentPenalty: -3,
      endgameCandidatePressure: 6,
    }),
  },
};

function mk(partial: Partial<FeatureWeights>): FeatureWeights {
  return { ...zeroWeights(), ...partial };
}

/** Instantiate the seeded champions as chromosomes for a population. */
export function seededChampions(generationBorn: number, mutationRate: number): Chromosome[] {
  return (Object.keys(CHAMPION_PRESETS) as PresetKey[]).map((key) => ({
    id: `seed-${key}`,
    weights: { ...CHAMPION_PRESETS[key].weights },
    mutationRate,
    generationBorn,
  }));
}

/** Build a baseline chromosome for the comparison panel. */
export function presetChromosome(key: PresetKey): Chromosome {
  return {
    id: `baseline-${key}`,
    weights: { ...CHAMPION_PRESETS[key].weights },
    mutationRate: 0,
    generationBorn: 0,
  };
}

// ---------------------------------------------------------------------------
// Diversity metrics — cosine (direction) based, because the player uses argmax
// of a weighted sum and is therefore invariant to positive scaling. Euclidean
// distance would reward magnitude drift that changes no behaviour.
// ---------------------------------------------------------------------------

export function cosineDistance(a: FeatureWeights, b: FeatureWeights): number {
  const av = weightsToArray(a);
  const bv = weightsToArray(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < av.length; i++) {
    dot += av[i] * bv[i];
    na += av[i] * av[i];
    nb += bv[i] * bv[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return na === nb ? 0 : 1;
  return 1 - dot / denom;
}

/** Mean cosine distance of the population to its (normalized) centroid. */
export function populationDiversity(pop: Chromosome[]): number {
  if (pop.length === 0) return 0;
  const n = FEATURE_ORDER.length;
  const units: Float64Array[] = [];
  const centroid = new Float64Array(n);

  for (const c of pop) {
    const v = weightsToArray(c.weights);
    let norm = 0;
    for (let i = 0; i < n; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    const u = new Float64Array(n);
    if (norm > 0) for (let i = 0; i < n; i++) u[i] = v[i] / norm;
    units.push(u);
    for (let i = 0; i < n; i++) centroid[i] += u[i];
  }
  for (let i = 0; i < n; i++) centroid[i] /= pop.length;

  let cNorm = 0;
  for (let i = 0; i < n; i++) cNorm += centroid[i] * centroid[i];
  cNorm = Math.sqrt(cNorm);

  let sum = 0;
  for (const u of units) {
    if (cNorm === 0) {
      sum += 1;
      continue;
    }
    let dot = 0;
    for (let i = 0; i < n; i++) dot += u[i] * centroid[i];
    sum += 1 - dot / cNorm; // each u is already unit length
  }
  return sum / pop.length;
}

// ---------------------------------------------------------------------------
// Playful nicknames derived from a chromosome's dominant weights.
// ---------------------------------------------------------------------------

export function nickname(c: Chromosome): string {
  const w = c.weights;
  const top = dominantFeature(w);

  if (c.mutationRate > 0.4) return 'Mutation gremlin';
  if (magnitude(w) < 4) return 'Caveman guesser';

  switch (top) {
    case 'entropyScore':
    case 'expectedRemainingPenalty':
      return 'Entropy enjoyer';
    case 'candidateBonus':
    case 'endgameCandidatePressure':
      return 'Candidate sniper';
    case 'letterFrequencyScore':
    case 'positionalFrequencyScore':
      return 'Frequency fiend';
    case 'vowelCoverageScore':
      return 'Vowel goblin';
    case 'uniqueLetterBonus':
      return 'Letter spreader';
    default:
      return 'Curious bot';
  }
}

function dominantFeature(w: FeatureWeights): FeatureName {
  let best: FeatureName = FEATURE_ORDER[0];
  let bestVal = -Infinity;
  for (const f of FEATURE_ORDER) {
    const v = Math.abs(w[f]);
    if (v > bestVal) {
      bestVal = v;
      best = f;
    }
  }
  return best;
}

function magnitude(w: FeatureWeights): number {
  let s = 0;
  for (const f of FEATURE_ORDER) s += w[f] * w[f];
  return Math.sqrt(s);
}
