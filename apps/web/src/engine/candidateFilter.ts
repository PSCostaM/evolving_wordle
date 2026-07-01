// Candidate filtering + constraint accumulation.
//
// Filtering is defined the simplest correct way: after a guess produces an
// observed feedback pattern, the answers still possible are exactly those that
// WOULD have produced the same pattern. (answer consistent  ⇔
// computeFeedback(guess, answer) === observedFeedback.)

import { patternOf } from './wordle';
import { letterCode } from './wordle';
import { Feedback, PlayedTurn, WORD_LENGTH } from './types';

/**
 * Pure, string-based filter used by tests and the UI. Keeps every answer whose
 * feedback for `guess` equals the observed pattern.
 */
export function filterCandidates(
  answers: readonly string[],
  guess: string,
  observedPattern: number,
): string[] {
  const out: string[] = [];
  for (const answer of answers) {
    if (patternOf(guess, answer) === observedPattern) out.push(answer);
  }
  return out;
}

/** Everything the bot has deduced from feedback so far. */
export interface Constraints {
  /** greens[i] = letter code fixed at position i, or -1. */
  greens: Int8Array;
  /** letters known to be present somewhere (includes greens). */
  presentLetters: Set<number>;
  /** letters known to be entirely absent (respecting repeated-letter logic). */
  absentLetters: Set<number>;
  /** excluded[i] = letter codes that produced a yellow at position i. */
  excluded: Array<Set<number>>;
  /** minimum known count of each letter (0..5). */
  minCounts: Int8Array;
  /** number of confirmed green positions. */
  greenCount: number;
}

export function emptyConstraints(): Constraints {
  return {
    greens: new Int8Array(WORD_LENGTH).fill(-1),
    presentLetters: new Set<number>(),
    absentLetters: new Set<number>(),
    excluded: Array.from({ length: WORD_LENGTH }, () => new Set<number>()),
    minCounts: new Int8Array(26),
    greenCount: 0,
  };
}

/**
 * Derive constraints from a game's history. `history` items only need `guess`
 * and `feedback`.
 */
export function deriveConstraints(
  history: ReadonlyArray<Pick<PlayedTurn, 'guess' | 'feedback'>>,
): Constraints {
  const c = emptyConstraints();
  const seenAbsent = new Set<number>();

  for (const turn of history) {
    const { guess, feedback } = turn;
    const perGuessCount = new Int8Array(26);

    for (let i = 0; i < WORD_LENGTH; i++) {
      const code = letterCode(guess[i]);
      const state = feedback[i];
      if (state === 'correct') {
        c.greens[i] = code;
        c.presentLetters.add(code);
        perGuessCount[code]++;
      } else if (state === 'present') {
        c.presentLetters.add(code);
        c.excluded[i].add(code);
        perGuessCount[code]++;
      } else {
        seenAbsent.add(code);
      }
    }

    // A guess pins the minimum count of each letter it revealed.
    for (let code = 0; code < 26; code++) {
      if (perGuessCount[code] > c.minCounts[code]) c.minCounts[code] = perGuessCount[code];
    }
  }

  // greenCount + fully-absent set (a letter is only "absent" if never seen
  // present/green anywhere — otherwise a repeated copy simply isn't there).
  for (let i = 0; i < WORD_LENGTH; i++) if (c.greens[i] >= 0) c.greenCount++;
  for (const code of seenAbsent) {
    if (!c.presentLetters.has(code)) c.absentLetters.add(code);
  }

  return c;
}

/** Feedback array -> whether it is the winning (all-correct) pattern. */
export function isWinningFeedback(feedback: Feedback): boolean {
  return feedback.every((s) => s === 'correct');
}
