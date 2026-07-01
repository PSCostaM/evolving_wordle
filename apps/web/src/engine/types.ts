// Shared types + constants for the whole simulation.
// This module has ZERO dependencies on other engine/GA/worker code so it can be
// imported everywhere (including the Web Worker) without creating cycles.

// ---------------------------------------------------------------------------
// Wordle primitives
// ---------------------------------------------------------------------------

/** The three feedback states for a single tile. */
export type TileState = 'correct' | 'present' | 'absent';

/** Feedback for a 5-letter guess: exactly 5 tile states. */
export type Feedback = [TileState, TileState, TileState, TileState, TileState];

/** Base-3 digit values used when encoding a feedback pattern into an integer. */
export const TILE_DIGIT: Record<TileState, number> = {
  absent: 0,
  present: 1,
  correct: 2,
};

/** Powers of three for the 5 tile positions (little-endian). */
export const POW3 = [1, 3, 9, 27, 81] as const;

/** The all-correct pattern (2·(1+3+9+27+81) = 242). Guessing the answer. */
export const WIN_PATTERN = 242;

/** Number of distinct feedback patterns (3^5). */
export const PATTERN_COUNT = 243;

/** Word length. Wordle is always five letters. */
export const WORD_LENGTH = 5;

/** Sentinel used for un-materialized matrix rows (255 is outside 0..242). */
export const UNFILLED = 255;

// ---------------------------------------------------------------------------
// Heuristic features
// ---------------------------------------------------------------------------

/** The 12 heuristic feature names, in a FROZEN order (stable FP summation). */
export const FEATURE_ORDER = [
  'candidateBonus',
  'entropyScore',
  'expectedRemainingPenalty',
  'letterFrequencyScore',
  'positionalFrequencyScore',
  'uniqueLetterBonus',
  'duplicateLetterPenalty',
  'vowelCoverageScore',
  'knownGreenBonus',
  'knownYellowBonus',
  'knownAbsentPenalty',
  'endgameCandidatePressure',
] as const;

export type FeatureName = (typeof FEATURE_ORDER)[number];

export const FEATURE_COUNT = FEATURE_ORDER.length;

/** Human-friendly labels + one-line explanations for the UI. */
export const FEATURE_META: Record<FeatureName, { label: string; blurb: string }> = {
  candidateBonus: {
    label: 'Candidate bonus',
    blurb: 'Reward guessing a word that is still a possible answer.',
  },
  entropyScore: {
    label: 'Entropy',
    blurb: 'Reward guesses that split the remaining candidates into many even buckets.',
  },
  expectedRemainingPenalty: {
    label: 'Expected remaining',
    blurb: 'How many candidates a guess leaves on average (usually penalised).',
  },
  letterFrequencyScore: {
    label: 'Letter frequency',
    blurb: 'Reward common letters among the remaining candidates.',
  },
  positionalFrequencyScore: {
    label: 'Positional frequency',
    blurb: 'Reward letters that sit in their most common position.',
  },
  uniqueLetterBonus: {
    label: 'Unique letters',
    blurb: 'Reward distinct letters, especially early on.',
  },
  duplicateLetterPenalty: {
    label: 'Duplicate letters',
    blurb: 'Discourage repeated letters early (unless plausible).',
  },
  vowelCoverageScore: {
    label: 'Vowel coverage',
    blurb: 'Reward discovering vowels early.',
  },
  knownGreenBonus: {
    label: 'Respect greens',
    blurb: 'Reward keeping confirmed green letters in place.',
  },
  knownYellowBonus: {
    label: 'Use yellows',
    blurb: 'Reward re-using known present letters in new positions.',
  },
  knownAbsentPenalty: {
    label: 'Avoid absents',
    blurb: 'Penalise re-using letters known to be absent.',
  },
  endgameCandidatePressure: {
    label: 'Endgame pressure',
    blurb: 'Strongly reward guessing a real candidate when few remain.',
  },
};

/** A chromosome's numeric weights, one per feature. */
export type FeatureWeights = Record<FeatureName, number>;

// ---------------------------------------------------------------------------
// Chromosome
// ---------------------------------------------------------------------------

export interface Chromosome {
  id: string;
  weights: FeatureWeights;
  mutationRate: number;
  generationBorn: number;
}

/** Convert named weights into a Float64Array in FEATURE_ORDER. */
export function weightsToArray(weights: FeatureWeights): Float64Array {
  const out = new Float64Array(FEATURE_COUNT);
  for (let i = 0; i < FEATURE_COUNT; i++) out[i] = weights[FEATURE_ORDER[i]];
  return out;
}

/** Convert an ordered array back into named weights. */
export function arrayToWeights(arr: ArrayLike<number>): FeatureWeights {
  const out = {} as FeatureWeights;
  for (let i = 0; i < FEATURE_COUNT; i++) out[FEATURE_ORDER[i]] = arr[i] ?? 0;
  return out;
}

// ---------------------------------------------------------------------------
// Gameplay
// ---------------------------------------------------------------------------

/** A single played turn: the guess and the feedback pattern it produced. */
export interface PlayedTurn {
  guess: string;
  guessIndex: number;
  pattern: number;
  feedback: Feedback;
  candidatesBefore: number;
  candidatesAfter: number;
}

/** Result of a bot playing one full game. */
export interface GameResult {
  answer: string;
  solved: boolean;
  guessCount: number; // number of guesses used (maxTurns if unsolved)
  turns: PlayedTurn[];
  remainingAfterGuess2: number; // candidates left after the 2nd guess
}

/** One alternative guess considered by the player (for explainability). */
export interface CandidateScore {
  word: string;
  score: number;
  features: Record<string, number>;
}

/** Full, explainable decision for a single turn. */
export interface GuessDecision {
  guess: string;
  score: number;
  features: Record<string, number>;
  weightedBreakdown: Record<string, number>;
  topCandidates: CandidateScore[];
}

/** A fully-explained match (used by the replay / explainability UI). */
export interface DetailedTurn extends PlayedTurn {
  decision: GuessDecision;
}

export interface DetailedMatch {
  answer: string;
  solved: boolean;
  guessCount: number;
  turns: DetailedTurn[];
}

// ---------------------------------------------------------------------------
// Fitness + evolution configuration
// ---------------------------------------------------------------------------

/** Aggregate performance stats for a chromosome over a sample of games. */
export interface ChromosomeStats {
  games: number;
  wins: number;
  winRate: number;
  failureRate: number;
  avgGuesses: number; // averaged over ALL games (losses count as maxTurns)
  solvedIn3OrLessRate: number;
  avgRemainingAfterGuess2: number;
  /** histogram[i] = games solved in i guesses (1..6); histogram[0] = failures. */
  histogram: number[];
}

/** Configurable coefficients for the fitness formula (surfaced in the UI). */
export interface FitnessCoefficients {
  winRateWeight: number;
  avgGuessesWeight: number;
  failureRateWeight: number;
  solvedIn3OrLessWeight: number;
  remainingAfterGuess2Weight: number;
}

export const DEFAULT_FITNESS: FitnessCoefficients = {
  winRateWeight: 10000,
  avgGuessesWeight: 800,
  failureRateWeight: 5000,
  solvedIn3OrLessWeight: 1000,
  remainingAfterGuess2Weight: 5,
};

/** All knobs that drive a training run. */
export interface EvolutionConfig {
  populationSize: number;
  generations: number;
  eliteCount: number;
  tournamentSize: number;
  mutationRate: number;
  largeMutationChance: number;
  trainingSampleSize: number;
  validationSampleSize: number;
  seed: string;
  fastMode: boolean;
  useEntropy: boolean;
  maxTurns: number;

  // GA tuning
  crossoverRate: number;
  blendAlpha: number;
  mutationSigma: number;
  largeMutationSigma: number;
  weightClampMin: number;
  weightClampMax: number;
  cloneCosineEps: number;

  // Termination
  terminationMode: 'fixed' | 'plateau' | 'manual';
  plateauGenerations: number;
  plateauEpsilon: number;

  fitness: FitnessCoefficients;
}

export const DEFAULT_CONFIG: EvolutionConfig = {
  populationSize: 60,
  generations: 50,
  eliteCount: 6,
  tournamentSize: 5,
  mutationRate: 0.15,
  largeMutationChance: 0.03,
  trainingSampleSize: 120,
  validationSampleSize: 120,
  seed: 'codebullet-wordle',
  fastMode: true,
  useEntropy: true,
  maxTurns: 6,

  crossoverRate: 0.9,
  blendAlpha: 0.35,
  mutationSigma: 0.9,
  largeMutationSigma: 4,
  weightClampMin: -10,
  weightClampMax: 10,
  cloneCosineEps: 0.02,

  terminationMode: 'fixed',
  plateauGenerations: 8,
  plateauEpsilon: 1,

  fitness: DEFAULT_FITNESS,
};

// ---------------------------------------------------------------------------
// Performance caps (fast vs full mode)
// ---------------------------------------------------------------------------

export interface PerfCaps {
  /** Max candidates sampled when estimating entropy / expected-remaining. */
  cSampleCap: number;
  /** Max size of the per-turn guess pool (turns >= 2). */
  poolCap: number;
  /** Number of exploration probe words injected into turns >= 2. */
  probeSetSize: number;
  /** Size of the precomputed turn-1 opener pool. */
  openerCap: number;
  /** Below this many candidates, drop probes (endgame-ish). */
  probeThreshold: number;
}

export const FAST_CAPS: PerfCaps = {
  cSampleCap: 64,
  poolCap: 160,
  probeSetSize: 96,
  openerCap: 3000,
  probeThreshold: 10,
};

export const FULL_CAPS: PerfCaps = {
  cSampleCap: 512,
  poolCap: 400,
  probeSetSize: 256,
  openerCap: 3000,
  probeThreshold: 4,
};

export function capsFor(fastMode: boolean): PerfCaps {
  return fastMode ? FAST_CAPS : FULL_CAPS;
}
