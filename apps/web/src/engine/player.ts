// The heuristic Wordle player.
//
// Two entry points share the same feature machinery:
//  * selectGuessIndex(): the HOT path used during training. Minimal allocation,
//    returns just the chosen guess index. Turn 1 uses the precomputed opener
//    table (chromosome-independent features) so it is a cheap weighted argmax.
//  * chooseGuess(): the EXPLAINABLE path used by the UI/replay. Same choice,
//    plus per-feature values, weighted contributions, and the top alternatives.

import type { EngineContext } from './evaluate';
import {
  FeatureContext,
  TurnAggregates,
  TurnState,
  computeAggregates,
  computeFeatureRow,
  buildEntropySample,
  makeAggregates,
  normalizePool,
} from './features';
import { deriveConstraints, emptyConstraints } from './candidateFilter';
import {
  CandidateScore,
  Chromosome,
  FEATURE_COUNT,
  FEATURE_ORDER,
  FeatureName,
  GuessDecision,
  PATTERN_COUNT,
  PlayedTurn,
  weightsToArray,
} from './types';

const ENTROPY_IDX = 1; // FEATURE_ORDER index of entropyScore
const EXPREM_IDX = 2; // FEATURE_ORDER index of expectedRemainingPenalty

/** Zero the entropy-derived weights when entropy is disabled. */
export function effectiveWeights(weights: Float64Array, useEntropy: boolean): Float64Array {
  if (useEntropy) return weights;
  const w = Float64Array.from(weights);
  w[ENTROPY_IDX] = 0;
  w[EXPREM_IDX] = 0;
  return w;
}

// ---------------------------------------------------------------------------
// Reusable scratch buffers (one per worker / per game loop).
// ---------------------------------------------------------------------------

export interface PlayerScratch {
  raw: Float32Array; // maxPool * 12
  norm: Float32Array; // maxPool * 12
  scores: Float64Array; // maxPool
  poolGuess: Int32Array; // maxPool (guess indices)
  hist: Int32Array; // 243
  entropySample: Int32Array; // A
  inCandidate: Uint8Array; // A
  poolStamp: Int32Array; // G
  agg: TurnAggregates;
  stamp: number;
}

export function makeScratch(maxPool: number, answerCount: number, guessCount: number): PlayerScratch {
  return {
    raw: new Float32Array(maxPool * FEATURE_COUNT),
    norm: new Float32Array(maxPool * FEATURE_COUNT),
    scores: new Float64Array(maxPool),
    poolGuess: new Int32Array(maxPool),
    hist: new Int32Array(PATTERN_COUNT),
    entropySample: new Int32Array(answerCount),
    inCandidate: new Uint8Array(answerCount),
    poolStamp: new Int32Array(guessCount),
    agg: makeAggregates(),
    stamp: 1,
  };
}

// ---------------------------------------------------------------------------
// Pool construction (turns >= 2).
// ---------------------------------------------------------------------------

function buildPool(
  ctx: EngineContext,
  scratch: PlayerScratch,
  candidates: Int32Array,
  count: number,
  turn: number,
  guessed: number[],
): number {
  const caps = ctx.caps;
  const pool = scratch.poolGuess;
  const stamp = ++scratch.stamp;
  const stampArr = scratch.poolStamp;
  const turnsRemaining = ctx.maxTurns - turn;
  let poolSize = 0;

  const isGuessed = (gi: number) => guessed.includes(gi);

  // Candidates first (they can win this turn).
  for (let i = 0; i < count && poolSize < caps.poolCap; i++) {
    const gi = ctx.answerToGuess[candidates[i]];
    if (isGuessed(gi)) continue;
    stampArr[gi] = stamp;
    pool[poolSize++] = gi;
  }

  // Exploration probes, only when we can afford a non-winning guess and there
  // is still meaningful uncertainty. Endgame => candidates only.
  const allowProbes = count > 2 && turnsRemaining > 1 && count > caps.probeThreshold;
  if (allowProbes) {
    const probes = ctx.probeIndices;
    for (let i = 0; i < probes.length && poolSize < caps.poolCap; i++) {
      const gi = probes[i];
      if (stampArr[gi] === stamp) continue; // already a candidate
      if (isGuessed(gi)) continue;
      stampArr[gi] = stamp;
      pool[poolSize++] = gi;
    }
  }

  return poolSize;
}

// ---------------------------------------------------------------------------
// Core scoring: fills scratch.raw / .norm / .scores for a turn-2+ pool.
// ---------------------------------------------------------------------------

function scorePool(
  ctx: EngineContext,
  weights: Float64Array,
  scratch: PlayerScratch,
  candidates: Int32Array,
  count: number,
  history: PlayedTurn[],
  turn: number,
): number {
  const fctx: FeatureContext = ctx.featureContext;
  const guessed = history.map((h) => h.guessIndex);
  const poolSize = buildPool(ctx, scratch, candidates, count, turn, guessed);

  // Per-turn aggregates over the FULL candidate set (once, not per guess).
  computeAggregates(candidates, count, ctx.answerCodes, ctx.answerDupFlags, scratch.agg);

  // Deterministic entropy sub-sample.
  const sampleCount = buildEntropySample(candidates, count, ctx.caps.cSampleCap, scratch.entropySample);

  // Candidate membership for candidateBonus.
  for (let i = 0; i < count; i++) scratch.inCandidate[candidates[i]] = 1;

  const state: TurnState = {
    turn,
    maxTurns: ctx.maxTurns,
    constraints: turn === 0 ? emptyConstraints() : deriveConstraints(history),
    inCandidate: scratch.inCandidate,
    entropySample: scratch.entropySample,
    sampleCount,
    useEntropy: ctx.useEntropy,
  };

  for (let p = 0; p < poolSize; p++) {
    computeFeatureRow(scratch.raw, p * FEATURE_COUNT, scratch.poolGuess[p], fctx, scratch.agg, state, scratch.hist);
  }
  normalizePool(scratch.raw, poolSize, scratch.norm);

  for (let p = 0; p < poolSize; p++) {
    const base = p * FEATURE_COUNT;
    let s = 0;
    for (let f = 0; f < FEATURE_COUNT; f++) s += weights[f] * scratch.norm[base + f];
    scratch.scores[p] = s;
  }

  // Reset candidate membership for reuse next turn.
  for (let i = 0; i < count; i++) scratch.inCandidate[candidates[i]] = 0;

  return poolSize;
}

/** argmax over the current pool, breaking ties by lowest guess index. */
function argmaxPool(scratch: PlayerScratch, poolSize: number): number {
  let best = 0;
  let bestScore = -Infinity;
  let bestGi = Infinity;
  for (let p = 0; p < poolSize; p++) {
    const s = scratch.scores[p];
    const gi = scratch.poolGuess[p];
    if (s > bestScore || (s === bestScore && gi < bestGi)) {
      bestScore = s;
      bestGi = gi;
      best = p;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Turn-1 fast path (precomputed opener table).
// ---------------------------------------------------------------------------

/** The chromosome-independent first guess is a cheap weighted argmax. */
export function firstGuessIndex(ctx: EngineContext, weights: Float64Array): number {
  const pool = ctx.openerPool;
  const norm = ctx.turn1Norm;
  let bestGi = pool[0];
  let bestScore = -Infinity;
  for (let r = 0; r < pool.length; r++) {
    const base = r * FEATURE_COUNT;
    let s = 0;
    for (let f = 0; f < FEATURE_COUNT; f++) s += weights[f] * norm[base + f];
    const gi = pool[r];
    if (s > bestScore || (s === bestScore && gi < bestGi)) {
      bestScore = s;
      bestGi = gi;
    }
  }
  return bestGi;
}

// ---------------------------------------------------------------------------
// Public selection (hot path).
// ---------------------------------------------------------------------------

/**
 * Choose the guess index for the current turn. `weights` should already be the
 * EFFECTIVE weights (see effectiveWeights). `candidates` are answer indices.
 */
export function selectGuessIndex(
  ctx: EngineContext,
  weights: Float64Array,
  scratch: PlayerScratch,
  candidates: Int32Array,
  count: number,
  history: PlayedTurn[],
  turn: number,
): number {
  if (turn === 0) return firstGuessIndex(ctx, weights);
  const poolSize = scorePool(ctx, weights, scratch, candidates, count, history, turn);
  return scratch.poolGuess[argmaxPool(scratch, poolSize)];
}

// ---------------------------------------------------------------------------
// Explainable selection (UI / replay).
// ---------------------------------------------------------------------------

function rowToRecord(source: Float32Array, base: number): Record<string, number> {
  const rec: Record<string, number> = {};
  for (let f = 0; f < FEATURE_COUNT; f++) rec[FEATURE_ORDER[f]] = source[base + f];
  return rec;
}

function weightedRecord(
  weights: Float64Array,
  norm: Float32Array,
  base: number,
): Record<string, number> {
  const rec: Record<string, number> = {};
  for (let f = 0; f < FEATURE_COUNT; f++) rec[FEATURE_ORDER[f]] = weights[f] * norm[base + f];
  return rec;
}

export interface ChooseGuessInput {
  ctx: EngineContext;
  chromosome: Chromosome;
  /** current candidate answer indices */
  candidates: Int32Array;
  count: number;
  history: PlayedTurn[];
  turn: number;
}

/**
 * Explainable version of the player's decision — matches selectGuessIndex's
 * choice exactly, and additionally exposes feature values, weighted
 * contributions, and the top-5 alternatives for the UI.
 */
export function chooseGuess(input: ChooseGuessInput): GuessDecision {
  const { ctx, chromosome, candidates, count, history, turn } = input;
  const weights = effectiveWeights(weightsToArray(chromosome.weights), ctx.useEntropy);
  const scratch = ctx.explainScratch;

  if (turn === 0) {
    // Score openers with the precomputed normalized table; read raw features
    // from the precomputed raw table (kept in sync at init).
    const pool = ctx.openerPool;
    const norm = ctx.turn1Norm;
    const raw = ctx.turn1Raw;
    const scored: Array<{ r: number; gi: number; score: number }> = [];
    for (let r = 0; r < pool.length; r++) {
      const base = r * FEATURE_COUNT;
      let s = 0;
      for (let f = 0; f < FEATURE_COUNT; f++) s += weights[f] * norm[base + f];
      scored.push({ r, gi: pool[r], score: s });
    }
    scored.sort((a, b) => b.score - a.score || a.gi - b.gi);
    const bestEntry = scored[0];
    const top: CandidateScore[] = scored.slice(0, 5).map((e) => ({
      word: ctx.guesses[e.gi],
      score: e.score,
      features: rowToRecord(raw, e.r * FEATURE_COUNT),
    }));
    return {
      guess: ctx.guesses[bestEntry.gi],
      score: bestEntry.score,
      features: rowToRecord(raw, bestEntry.r * FEATURE_COUNT),
      weightedBreakdown: weightedRecord(weights, norm, bestEntry.r * FEATURE_COUNT),
      topCandidates: top,
    };
  }

  const poolSize = scorePool(ctx, weights, scratch, candidates, count, history, turn);
  const order = Array.from({ length: poolSize }, (_, p) => p).sort(
    (a, b) => scratch.scores[b] - scratch.scores[a] || scratch.poolGuess[a] - scratch.poolGuess[b],
  );
  const bestPos = order[0];
  const top: CandidateScore[] = order.slice(0, 5).map((p) => ({
    word: ctx.guesses[scratch.poolGuess[p]],
    score: scratch.scores[p],
    features: rowToRecord(scratch.raw, p * FEATURE_COUNT),
  }));

  return {
    guess: ctx.guesses[scratch.poolGuess[bestPos]],
    score: scratch.scores[bestPos],
    features: rowToRecord(scratch.raw, bestPos * FEATURE_COUNT),
    weightedBreakdown: weightedRecord(weights, scratch.norm, bestPos * FEATURE_COUNT),
    topCandidates: top,
  };
}

/** Utility for the UI: map named weights to their FEATURE_ORDER index list. */
export const FEATURE_NAMES: readonly FeatureName[] = FEATURE_ORDER;
