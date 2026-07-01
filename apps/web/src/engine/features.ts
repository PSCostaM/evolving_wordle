// Heuristic features.
//
// Design rules (see README "correctness"):
//  * Every feature returns a NON-NEGATIVE magnitude; the chromosome weight
//    carries the sign. So a "penalty" feature is just a magnitude the GA
//    typically learns a negative weight for. No double negatives.
//  * The expensive aggregates (letter/positional frequency over the candidate
//    set) are computed ONCE PER TURN, never per guess.
//  * entropyScore and expectedRemainingPenalty come from ONE 243-bucket tally.
//  * After building the raw feature rows for a pool, we min-max normalize each
//    feature column to [0,1] so entropy (~0..11 bits) and raw frequency counts
//    are comparable and the GA can actually balance them.

import { PatternMatrix, entropyOfHistogram, expectedRemaining } from './patternMatrix';
import { Constraints } from './candidateFilter';
import { FEATURE_COUNT, WORD_LENGTH } from './types';

const VOWEL_CODES = [0, 4, 8, 14, 20]; // a e i o u
const VOWEL_MASK = VOWEL_CODES.reduce((m, c) => m | (1 << c), 0);

/** Candidate count at/below which endgame pressure ramps toward 1. */
export const PRESSURE_THRESHOLD = 12;

// ---------------------------------------------------------------------------
// Static, per-word tables (computed once at init over the guess list).
// ---------------------------------------------------------------------------

export interface StaticWordTables {
  guessCodes: Uint8Array; // G*5 letter codes
  distinctCount: Uint8Array; // G — number of distinct letters
  duplicateCount: Uint8Array; // G — WORD_LENGTH - distinctCount
  vowelDistinct: Uint8Array; // G — number of distinct vowels
}

export function buildStaticTables(guesses: readonly string[]): StaticWordTables {
  const g = guesses.length;
  const guessCodes = new Uint8Array(g * WORD_LENGTH);
  const distinctCount = new Uint8Array(g);
  const duplicateCount = new Uint8Array(g);
  const vowelDistinct = new Uint8Array(g);

  for (let i = 0; i < g; i++) {
    const word = guesses[i];
    let mask = 0;
    let vmask = 0;
    for (let p = 0; p < WORD_LENGTH; p++) {
      const code = word.charCodeAt(p) - 97;
      guessCodes[i * WORD_LENGTH + p] = code;
      const bit = 1 << code;
      mask |= bit;
      if (VOWEL_MASK & bit) vmask |= bit;
    }
    const distinct = popcount(mask);
    distinctCount[i] = distinct;
    duplicateCount[i] = WORD_LENGTH - distinct;
    vowelDistinct[i] = popcount(vmask);
  }

  return { guessCodes, distinctCount, duplicateCount, vowelDistinct };
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

/** Per-answer helper: does this answer contain a repeated letter? */
export function buildAnswerDuplicateFlags(answers: readonly string[]): Uint8Array {
  const out = new Uint8Array(answers.length);
  for (let i = 0; i < answers.length; i++) {
    let mask = 0;
    let dup = 0;
    for (let p = 0; p < WORD_LENGTH; p++) {
      const bit = 1 << (answers[i].charCodeAt(p) - 97);
      if (mask & bit) dup = 1;
      mask |= bit;
    }
    out[i] = dup;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-turn aggregates over the current candidate set.
// ---------------------------------------------------------------------------

export interface TurnAggregates {
  letterPresence: Float32Array; // 26 — fraction of candidates containing letter
  positional: Float32Array; // 5*26 — fraction of candidates with letter at pos
  duplicatePlausibility: number; // fraction of candidates with a repeated letter
  candidateCount: number;
}

export function makeAggregates(): TurnAggregates {
  return {
    letterPresence: new Float32Array(26),
    positional: new Float32Array(WORD_LENGTH * 26),
    duplicatePlausibility: 0,
    candidateCount: 0,
  };
}

/**
 * Recompute aggregates over the candidate set (indices into the answer list).
 * O(|C| * 5). Reuses the provided TurnAggregates buffers.
 */
export function computeAggregates(
  candidates: ArrayLike<number>,
  count: number,
  answerCodes: Uint8Array,
  answerDupFlags: Uint8Array,
  agg: TurnAggregates,
): void {
  agg.letterPresence.fill(0);
  agg.positional.fill(0);
  let dupCandidates = 0;

  for (let i = 0; i < count; i++) {
    const a = candidates[i];
    const off = a * WORD_LENGTH;
    let mask = 0;
    for (let p = 0; p < WORD_LENGTH; p++) {
      const code = answerCodes[off + p];
      agg.positional[p * 26 + code]++;
      mask |= 1 << code;
    }
    // distinct-letter presence
    for (let code = 0; code < 26; code++) {
      if (mask & (1 << code)) agg.letterPresence[code]++;
    }
    dupCandidates += answerDupFlags[a];
  }

  if (count > 0) {
    const inv = 1 / count;
    for (let i = 0; i < 26; i++) agg.letterPresence[i] *= inv;
    for (let i = 0; i < WORD_LENGTH * 26; i++) agg.positional[i] *= inv;
    agg.duplicatePlausibility = dupCandidates * inv;
  } else {
    agg.duplicatePlausibility = 0;
  }
  agg.candidateCount = count;
}

/**
 * Build a deterministic sub-sample of candidate indices for entropy estimation.
 * If count <= cap, uses all of them. Otherwise takes evenly-spaced indices —
 * a pure function of the candidate array, so it is fully reproducible and never
 * touches an RNG stream (which would make results depend on iteration order).
 */
export function buildEntropySample(
  candidates: ArrayLike<number>,
  count: number,
  cap: number,
  out: Int32Array,
): number {
  if (count <= cap) {
    for (let i = 0; i < count; i++) out[i] = candidates[i];
    return count;
  }
  for (let i = 0; i < cap; i++) {
    out[i] = candidates[Math.floor((i * count) / cap)];
  }
  return cap;
}

// ---------------------------------------------------------------------------
// Feature context + per-guess feature row.
// ---------------------------------------------------------------------------

export interface FeatureContext {
  tables: StaticWordTables;
  guessToAnswer: Int32Array; // G -> answer index, or -1
  matrix: PatternMatrix;
}

export interface TurnState {
  turn: number; // 0-based (number of guesses already made)
  maxTurns: number;
  constraints: Constraints;
  inCandidate: Uint8Array; // A — 1 if answer index is a current candidate
  entropySample: Int32Array; // filled sub-sample
  sampleCount: number;
  useEntropy: boolean;
}

/**
 * Compute the 12-length raw feature row for guess `gi` into `out` at `off`.
 * `hist` is a reused Int32Array(243) scratch for the entropy tally.
 */
export function computeFeatureRow(
  out: Float32Array,
  off: number,
  gi: number,
  fctx: FeatureContext,
  agg: TurnAggregates,
  state: TurnState,
  hist: Int32Array,
): void {
  const { tables, guessToAnswer, matrix } = fctx;
  const codes = tables.guessCodes;
  const cOff = gi * WORD_LENGTH;
  const c0 = codes[cOff], c1 = codes[cOff + 1], c2 = codes[cOff + 2], c3 = codes[cOff + 3], c4 = codes[cOff + 4];

  const earlyFactor = (state.maxTurns - state.turn) / state.maxTurns;

  // -- candidateBonus + endgame pressure -----------------------------------
  const ai = guessToAnswer[gi];
  const isCandidate = ai >= 0 && state.inCandidate[ai] === 1 ? 1 : 0;
  out[off + 0] = isCandidate;

  // -- entropy + expected remaining (one tally) ----------------------------
  if (state.useEntropy) {
    matrix.tally(gi, state.entropySample, state.sampleCount, hist);
    out[off + 1] = entropyOfHistogram(hist, state.sampleCount);
    out[off + 2] = expectedRemaining(hist, state.sampleCount);
  } else {
    out[off + 1] = 0;
    out[off + 2] = 0;
  }

  // -- letter frequency (distinct letters only) + positional frequency -----
  const lp = agg.letterPresence;
  let mask = 0;
  let letterFreq = 0;
  // accumulate each distinct letter once
  if (!(mask & (1 << c0))) { letterFreq += lp[c0]; mask |= 1 << c0; }
  if (!(mask & (1 << c1))) { letterFreq += lp[c1]; mask |= 1 << c1; }
  if (!(mask & (1 << c2))) { letterFreq += lp[c2]; mask |= 1 << c2; }
  if (!(mask & (1 << c3))) { letterFreq += lp[c3]; mask |= 1 << c3; }
  if (!(mask & (1 << c4))) { letterFreq += lp[c4]; mask |= 1 << c4; }
  out[off + 3] = letterFreq;

  const pos = agg.positional;
  out[off + 4] =
    pos[c0] + pos[26 + c1] + pos[52 + c2] + pos[78 + c3] + pos[104 + c4];

  // -- unique / duplicate / vowel (decay with the game) --------------------
  out[off + 5] = (tables.distinctCount[gi] / WORD_LENGTH) * earlyFactor;
  out[off + 6] =
    (tables.duplicateCount[gi] / WORD_LENGTH) * earlyFactor * (1 - agg.duplicatePlausibility);

  // new vowels: distinct vowels in the guess not already known present
  let vmask = 0;
  let newVowels = 0;
  const present = state.constraints.presentLetters;
  for (const c of [c0, c1, c2, c3, c4]) {
    const bit = 1 << c;
    if (VOWEL_MASK & bit && !(vmask & bit)) {
      vmask |= bit;
      if (!present.has(c)) newVowels++;
    }
  }
  out[off + 7] = (newVowels / VOWEL_CODES.length) * earlyFactor;

  // -- known green / yellow / absent ---------------------------------------
  const con = state.constraints;
  let greenMatched = 0;
  const greens = con.greens;
  if (greens[0] === c0) greenMatched++;
  if (greens[1] === c1) greenMatched++;
  if (greens[2] === c2) greenMatched++;
  if (greens[3] === c3) greenMatched++;
  if (greens[4] === c4) greenMatched++;
  out[off + 8] = con.greenCount > 0 ? greenMatched / con.greenCount : 0;

  // yellows: known-present letters placed in a not-yet-excluded, non-green slot
  let yellowMatched = 0;
  if (present.size > 0) {
    for (const L of present) {
      let used = 0;
      for (let p = 0; p < WORD_LENGTH; p++) {
        if (codes[cOff + p] === L && greens[p] !== L && !con.excluded[p].has(L)) {
          used = 1;
          break;
        }
      }
      yellowMatched += used;
    }
    out[off + 9] = yellowMatched / present.size;
  } else {
    out[off + 9] = 0;
  }

  // absents: positions using a letter known to be entirely absent
  let absentHits = 0;
  const absent = con.absentLetters;
  if (absent.size > 0) {
    if (absent.has(c0)) absentHits++;
    if (absent.has(c1)) absentHits++;
    if (absent.has(c2)) absentHits++;
    if (absent.has(c3)) absentHits++;
    if (absent.has(c4)) absentHits++;
  }
  out[off + 10] = absentHits / WORD_LENGTH;

  // -- endgame candidate pressure ------------------------------------------
  let pressure = 0;
  const cc = agg.candidateCount;
  if (isCandidate && cc > 0) {
    pressure = Math.min(1, Math.max(0, (PRESSURE_THRESHOLD - cc) / PRESSURE_THRESHOLD));
  }
  out[off + 11] = pressure;
}

/**
 * Min-max normalize each of the 12 feature columns across a pool of `poolSize`
 * guesses. A column that is constant maps to all-zeros (contributes nothing).
 */
export function normalizePool(raw: Float32Array, poolSize: number, out: Float32Array): void {
  for (let f = 0; f < FEATURE_COUNT; f++) {
    let min = Infinity;
    let max = -Infinity;
    for (let p = 0; p < poolSize; p++) {
      const v = raw[p * FEATURE_COUNT + f];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min;
    if (range <= 1e-12) {
      for (let p = 0; p < poolSize; p++) out[p * FEATURE_COUNT + f] = 0;
    } else {
      const inv = 1 / range;
      for (let p = 0; p < poolSize; p++) {
        out[p * FEATURE_COUNT + f] = (raw[p * FEATURE_COUNT + f] - min) * inv;
      }
    }
  }
}
