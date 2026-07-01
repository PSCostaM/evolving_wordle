// Lazily-materialized feedback pattern matrix.
//
// Rows are a chosen subset of guess indices (the "opener pool" = every answer
// word plus a few hundred curated openers/probes). Columns are ALL answer
// indices. matrix[row][a] = base-3 feedback pattern of that guess vs answer a.
//
// Why a subset of rows? The hidden answer is always in the answer list, so
// candidate sets are always subsets of answers (~2.3k), and every word the bot
// ever guesses comes from `candidates ∪ probes ∪ openers` — never an arbitrary
// word from the full ~13k guess list. So we only ever tally ~3k rows, not 13k.
//
// Rows are filled on first touch (255 sentinel = "not yet computed"). A filled
// cell is identical regardless of fill order, so lazy materialization never
// affects results — only the timing of the one-time warm-up.

import { patternFromCodes } from './wordle';
import { PATTERN_COUNT, UNFILLED } from './types';

export class PatternMatrix {
  readonly answerCount: number;
  readonly rowCount: number;

  private data: Uint8Array; // rowCount * answerCount, init UNFILLED
  private filled: Uint8Array; // rowCount, 0/1
  private rowOf: Int32Array; // guessIndex -> row, or -1
  private rowGuess: Int32Array; // row -> guessIndex
  private guessCodes: Uint8Array; // fullGuessCount * 5
  private answerCodes: Uint8Array; // answerCount * 5
  private counts = new Int8Array(26);

  constructor(
    rowGuessIndices: Int32Array | number[],
    guessCount: number,
    guessCodes: Uint8Array,
    answerCodes: Uint8Array,
    answerCount: number,
  ) {
    this.answerCount = answerCount;
    this.rowCount = rowGuessIndices.length;
    this.guessCodes = guessCodes;
    this.answerCodes = answerCodes;

    this.data = new Uint8Array(this.rowCount * answerCount).fill(UNFILLED);
    this.filled = new Uint8Array(this.rowCount);
    this.rowOf = new Int32Array(guessCount).fill(-1);
    this.rowGuess = new Int32Array(this.rowCount);

    for (let r = 0; r < this.rowCount; r++) {
      const gi = rowGuessIndices[r];
      this.rowOf[gi] = r;
      this.rowGuess[r] = gi;
    }
  }

  /** Approximate memory footprint of the dense matrix, in bytes. */
  get byteSize(): number {
    return this.data.byteLength;
  }

  /** True if this guess index has a materializable row. */
  hasRow(guessIndex: number): boolean {
    return this.rowOf[guessIndex] >= 0;
  }

  /** Materialize a row if needed; returns the row index. */
  private ensureRow(guessIndex: number): number {
    const r = this.rowOf[guessIndex];
    if (r < 0) throw new Error(`PatternMatrix: guess index ${guessIndex} has no row`);
    if (this.filled[r]) return r;
    const base = r * this.answerCount;
    const gOff = guessIndex * 5;
    const aCodes = this.answerCodes;
    const counts = this.counts;
    const gCodes = this.guessCodes;
    for (let a = 0; a < this.answerCount; a++) {
      this.data[base + a] = patternFromCodes(gCodes, gOff, aCodes, a * 5, counts);
    }
    this.filled[r] = 1;
    return r;
  }

  /** Feedback pattern of guess vs a specific answer. */
  pattern(guessIndex: number, answerIndex: number): number {
    const r = this.ensureRow(guessIndex);
    return this.data[r * this.answerCount + answerIndex];
  }

  /**
   * Tally the feedback patterns of `guessIndex` over a set of candidate answer
   * indices into a reused 243-bucket histogram. Returns nothing; read `out`.
   */
  tally(guessIndex: number, candidates: ArrayLike<number>, count: number, out: Int32Array): void {
    const r = this.ensureRow(guessIndex);
    const base = r * this.answerCount;
    out.fill(0);
    const data = this.data;
    for (let i = 0; i < count; i++) {
      out[data[base + candidates[i]]]++;
    }
  }

  /**
   * Filter candidate answer indices to those whose feedback for
   * (guessIndex, observedPattern) matches — i.e. the answers still consistent
   * with what the bot saw. Writes into `out` and returns the new length.
   */
  filter(
    guessIndex: number,
    observedPattern: number,
    candidates: ArrayLike<number>,
    count: number,
    out: Int32Array,
  ): number {
    const r = this.ensureRow(guessIndex);
    const base = r * this.answerCount;
    const data = this.data;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const a = candidates[i];
      if (data[base + a] === observedPattern) out[n++] = a;
    }
    return n;
  }

  /** Warm every row (used by an eager init path; safe to skip). */
  warmAll(onProgress?: (done: number, total: number) => void): void {
    for (let r = 0; r < this.rowCount; r++) {
      if (!this.filled[r]) this.ensureRow(this.rowGuess[r]);
      if (onProgress && (r & 63) === 0) onProgress(r, this.rowCount);
    }
    onProgress?.(this.rowCount, this.rowCount);
  }
}

/** Compute Shannon entropy (bits) of a 243-bucket histogram over `total` items. */
export function entropyOfHistogram(hist: Int32Array, total: number): number {
  if (total <= 0) return 0;
  let h = 0;
  const invTotal = 1 / total;
  for (let k = 0; k < PATTERN_COUNT; k++) {
    const c = hist[k];
    if (c > 0) {
      const p = c * invTotal;
      h -= p * Math.log2(p);
    }
  }
  return h;
}

/** Expected remaining candidates after this guess: Σ count_k^2 / total. */
export function expectedRemaining(hist: Int32Array, total: number): number {
  if (total <= 0) return 0;
  let sum = 0;
  for (let k = 0; k < PATTERN_COUNT; k++) {
    const c = hist[k];
    if (c > 0) sum += c * c;
  }
  return sum / total;
}
