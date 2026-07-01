// Fitness + baseline evaluation.
//
// The fitness formula is exactly the one from the brief, with every coefficient
// configurable (and surfaced in the UI):
//
//   fitness = winRate                    * winRateWeight
//           - averageGuesses             * avgGuessesWeight
//           - failureRate                * failureRateWeight
//           + solvedIn3OrLessRate        * solvedIn3OrLessWeight
//           - avgRemainingAfterGuess2    * remainingAfterGuess2Weight
//
// It rewards winning and speed, punishes failures, gives a bonus for fast
// solves, and nudges toward guesses that shrink the candidate set early.

import { EngineContext, evaluateChromosomeStats } from '../engine/evaluate';
import { Rng } from '../engine/seedRandom';
import { PlayerScratch } from '../engine/player';
import { ChromosomeStats, FitnessCoefficients, WIN_PATTERN } from '../engine/types';
import { PresetKey, presetChromosome } from './chromosome';

export function computeFitness(stats: ChromosomeStats, coef: FitnessCoefficients): number {
  return (
    stats.winRate * coef.winRateWeight -
    stats.avgGuesses * coef.avgGuessesWeight -
    stats.failureRate * coef.failureRateWeight +
    stats.solvedIn3OrLessRate * coef.solvedIn3OrLessWeight -
    stats.avgRemainingAfterGuess2 * coef.remainingAfterGuess2Weight
  );
}

/** A textual breakdown of the fitness terms (for the UI tooltip/panel). */
export function fitnessBreakdown(
  stats: ChromosomeStats,
  coef: FitnessCoefficients,
): Array<{ term: string; value: number }> {
  return [
    { term: 'win rate', value: stats.winRate * coef.winRateWeight },
    { term: 'avg guesses', value: -stats.avgGuesses * coef.avgGuessesWeight },
    { term: 'failures', value: -stats.failureRate * coef.failureRateWeight },
    { term: 'solved ≤3', value: stats.solvedIn3OrLessRate * coef.solvedIn3OrLessWeight },
    {
      term: 'remaining after guess 2',
      value: -stats.avgRemainingAfterGuess2 * coef.remainingAfterGuess2Weight,
    },
  ];
}

// ---------------------------------------------------------------------------
// Baselines.
// ---------------------------------------------------------------------------

export type BaselineKey = 'random' | PresetKey;

export const BASELINE_META: Record<BaselineKey, string> = {
  random: 'Random guesser',
  entropy: 'Entropy-heavy bot',
  frequency: 'Frequency bot',
  candidate: 'Candidate-only bot',
  balanced: 'Balanced bot',
};

export interface BaselineResult {
  key: BaselineKey;
  name: string;
  stats: ChromosomeStats;
  fitness: number;
}

export function evaluateBaseline(
  ctx: EngineContext,
  key: BaselineKey,
  scratch: PlayerScratch,
  answerIndices: Int32Array,
  count: number,
  coef: FitnessCoefficients,
  rng: Rng,
): BaselineResult {
  const stats =
    key === 'random'
      ? randomBaselineStats(ctx, answerIndices, count, rng)
      : evaluateChromosomeStats(ctx, presetChromosome(key), scratch, answerIndices, count);
  return { key, name: BASELINE_META[key], stats, fitness: computeFitness(stats, coef) };
}

/** The "random valid guesser": each turn it guesses a random remaining candidate. */
function randomBaselineStats(
  ctx: EngineContext,
  answerIndices: Int32Array,
  count: number,
  rng: Rng,
): ChromosomeStats {
  const A = ctx.answerCount;
  const cur = new Int32Array(A);
  const next = new Int32Array(A);

  const histogram = [0, 0, 0, 0, 0, 0, 0];
  let wins = 0;
  let solvedIn3 = 0;
  let sumGuesses = 0;
  let sumRemaining = 0;

  for (let gi = 0; gi < count; gi++) {
    const answerIndex = answerIndices[gi];
    for (let a = 0; a < A; a++) cur[a] = a;
    let n = A;
    let solved = false;
    let guessCount = ctx.maxTurns;
    let remainingAfter2 = 1;

    let source = cur;
    let dest = next;
    for (let turn = 0; turn < ctx.maxTurns; turn++) {
      const guessGuessIndex = ctx.answerToGuess[source[rng.int(n)]];
      const pattern = ctx.matrix.pattern(guessGuessIndex, answerIndex);
      if (pattern === WIN_PATTERN) {
        solved = true;
        guessCount = turn + 1;
        break;
      }
      const newCount = ctx.matrix.filter(guessGuessIndex, pattern, source, n, dest);
      const tmp = source;
      source = dest;
      dest = tmp;
      n = newCount;
      if (turn === 1) remainingAfter2 = newCount;
    }

    if (solved) {
      wins++;
      histogram[guessCount]++;
      sumGuesses += guessCount;
      if (guessCount <= 3) solvedIn3++;
    } else {
      histogram[0]++;
      sumGuesses += ctx.maxTurns;
    }
    sumRemaining += remainingAfter2;
  }

  return {
    games: count,
    wins,
    winRate: wins / count,
    failureRate: (count - wins) / count,
    avgGuesses: sumGuesses / count,
    solvedIn3OrLessRate: solvedIn3 / count,
    avgRemainingAfterGuess2: sumRemaining / count,
    histogram,
  };
}
