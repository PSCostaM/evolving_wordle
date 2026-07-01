// Wordle feedback scoring.
//
// The rule that trips people up is repeated letters. Scoring is TWO passes:
//   1. Mark exact-position matches ("correct"), consuming one copy of that
//      letter from the answer's available pool.
//   2. For the remaining tiles, mark "present" only while the answer still has
//      an unconsumed copy of that letter; otherwise "absent".
//
// Example: answer "apple" (a p p l e), guess "allee" (a l l e e).
//   pass 1: pos0 a==a correct; pos4 e==e correct.
//           answer letters still available (the non-green ones): p, p, l
//   pass 2: pos1 l -> 'l' available -> present, consume l  -> remaining p, p
//           pos2 l -> no 'l' left    -> absent
//           pos3 e -> no 'e' left    -> absent
//   => correct, present, absent, absent, correct

import { Feedback, POW3, TileState, TILE_DIGIT, WORD_LENGTH } from './types';

const A_CODE = 97; // 'a'

/** Lowercase letter -> 0..25 code. */
export function letterCode(ch: string): number {
  return ch.charCodeAt(0) - A_CODE;
}

/** Encode a whole word into a Uint8Array of 5 letter codes. */
export function wordToCodes(word: string, out: Uint8Array, offset: number): void {
  for (let i = 0; i < WORD_LENGTH; i++) out[offset + i] = word.charCodeAt(i) - A_CODE;
}

/**
 * Compute feedback for a guess against an answer. Both must be 5 lowercase
 * letters. Returns the 5 tile states.
 */
export function computeFeedback(guess: string, answer: string): Feedback {
  const result: TileState[] = ['absent', 'absent', 'absent', 'absent', 'absent'];
  const counts = new Int8Array(26);

  // Pass 1: greens. Non-green answer letters go into the available pool.
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === answer[i]) {
      result[i] = 'correct';
    } else {
      counts[answer.charCodeAt(i) - A_CODE]++;
    }
  }

  // Pass 2: presents, limited by remaining available counts.
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === 'correct') continue;
    const c = guess.charCodeAt(i) - A_CODE;
    if (counts[c] > 0) {
      result[i] = 'present';
      counts[c]--;
    }
  }

  return result as Feedback;
}

/** Encode a feedback array into a base-3 integer in [0, 242]. */
export function encodePattern(feedback: Feedback): number {
  let pattern = 0;
  for (let i = 0; i < WORD_LENGTH; i++) pattern += TILE_DIGIT[feedback[i]] * POW3[i];
  return pattern;
}

const DIGIT_TO_STATE: TileState[] = ['absent', 'present', 'correct'];

/** Decode a base-3 pattern integer back into a feedback array. */
export function decodePattern(pattern: number): Feedback {
  const out: TileState[] = ['absent', 'absent', 'absent', 'absent', 'absent'];
  let p = pattern;
  for (let i = 0; i < WORD_LENGTH; i++) {
    out[i] = DIGIT_TO_STATE[p % 3];
    p = Math.floor(p / 3);
  }
  return out as Feedback;
}

/** Convenience: feedback of a guess vs answer as a base-3 pattern integer. */
export function patternOf(guess: string, answer: string): number {
  return encodePattern(computeFeedback(guess, answer));
}

/**
 * Fast, allocation-free pattern computation over pre-encoded letter codes.
 * `counts` is a reused Int8Array(26) scratch buffer (cleared internally).
 * This is the hot path used to build the pattern matrix.
 */
export function patternFromCodes(
  gCodes: Uint8Array,
  gOff: number,
  aCodes: Uint8Array,
  aOff: number,
  counts: Int8Array,
): number {
  // clear only the 26 slots (cheaper than counts.fill on a fresh call site)
  counts[0] = 0; counts[1] = 0; counts[2] = 0; counts[3] = 0; counts[4] = 0;
  counts[5] = 0; counts[6] = 0; counts[7] = 0; counts[8] = 0; counts[9] = 0;
  counts[10] = 0; counts[11] = 0; counts[12] = 0; counts[13] = 0; counts[14] = 0;
  counts[15] = 0; counts[16] = 0; counts[17] = 0; counts[18] = 0; counts[19] = 0;
  counts[20] = 0; counts[21] = 0; counts[22] = 0; counts[23] = 0; counts[24] = 0;
  counts[25] = 0;

  // Pass 1: greens. digits stored little-endian; green digit = 2.
  let d0 = 0, d1 = 0, d2 = 0, d3 = 0, d4 = 0;
  const g0 = gCodes[gOff], g1 = gCodes[gOff + 1], g2 = gCodes[gOff + 2], g3 = gCodes[gOff + 3], g4 = gCodes[gOff + 4];
  const a0 = aCodes[aOff], a1 = aCodes[aOff + 1], a2 = aCodes[aOff + 2], a3 = aCodes[aOff + 3], a4 = aCodes[aOff + 4];

  if (g0 === a0) d0 = 2; else counts[a0]++;
  if (g1 === a1) d1 = 2; else counts[a1]++;
  if (g2 === a2) d2 = 2; else counts[a2]++;
  if (g3 === a3) d3 = 2; else counts[a3]++;
  if (g4 === a4) d4 = 2; else counts[a4]++;

  // Pass 2: presents.
  if (d0 === 0 && counts[g0] > 0) { d0 = 1; counts[g0]--; }
  if (d1 === 0 && counts[g1] > 0) { d1 = 1; counts[g1]--; }
  if (d2 === 0 && counts[g2] > 0) { d2 = 1; counts[g2]--; }
  if (d3 === 0 && counts[g3] > 0) { d3 = 1; counts[g3]--; }
  if (d4 === 0 && counts[g4] > 0) { d4 = 1; counts[g4]--; }

  return d0 + d1 * 3 + d2 * 9 + d3 * 27 + d4 * 81;
}
