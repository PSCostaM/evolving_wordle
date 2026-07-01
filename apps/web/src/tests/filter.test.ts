import { describe, expect, it } from 'vitest';
import { filterCandidates, deriveConstraints } from '../engine/candidateFilter';
import { computeFeedback, patternOf } from '../engine/wordle';
import { PatternMatrix } from '../engine/patternMatrix';
import { letterCode } from '../engine/wordle';
import { PlayedTurn } from '../engine/types';

const SAMPLE = [
  'crane',
  'slate',
  'trace',
  'crate',
  'plate',
  'grape',
  'brace',
  'place',
  'space',
  'shade',
  'blaze',
  'flame',
];

describe('filterCandidates', () => {
  it('keeps exactly the answers consistent with the observed feedback', () => {
    const answer = 'crate';
    const guess = 'crane';
    const pattern = patternOf(guess, answer);
    const filtered = filterCandidates(SAMPLE, guess, pattern);

    // Reference: brute-force the same predicate.
    const expected = SAMPLE.filter((w) => patternOf(guess, w) === pattern);
    expect(filtered.sort()).toEqual(expected.sort());
    // The true answer must survive its own feedback.
    expect(filtered).toContain(answer);
  });

  it('narrows to a single word when feedback is fully specific', () => {
    const answer = 'flame';
    const guess = 'flame';
    const pattern = patternOf(guess, answer);
    expect(filterCandidates(SAMPLE, guess, pattern)).toEqual(['flame']);
  });

  it('is consistent with computeFeedback for every candidate', () => {
    const guess = 'slate';
    for (const answer of SAMPLE) {
      const pattern = patternOf(guess, answer);
      const survivors = filterCandidates(SAMPLE, guess, pattern);
      for (const s of survivors) {
        expect(computeFeedback(guess, s)).toEqual(computeFeedback(guess, answer));
      }
    }
  });
});

describe('PatternMatrix filter matches the pure filter', () => {
  it('produces identical candidate sets', () => {
    const answers = SAMPLE;
    const A = answers.length;
    const answerCodes = new Uint8Array(A * 5);
    for (let a = 0; a < A; a++) {
      for (let p = 0; p < 5; p++) answerCodes[a * 5 + p] = letterCode(answers[a][p]);
    }
    // Rows: use answers themselves as guesses (guess list == answer list here).
    const rowIdx = Int32Array.from(answers.map((_, i) => i));
    const matrix = new PatternMatrix(rowIdx, A, answerCodes, answerCodes, A);

    const guessIdx = answers.indexOf('crane');
    const answerIdx = answers.indexOf('crate');
    const pattern = matrix.pattern(guessIdx, answerIdx);

    const cur = Int32Array.from(answers.map((_, i) => i));
    const out = new Int32Array(A);
    const n = matrix.filter(guessIdx, pattern, cur, A, out);
    const viaMatrix = Array.from(out.subarray(0, n)).map((i) => answers[i]).sort();

    const viaPure = filterCandidates(answers, 'crane', pattern).sort();
    expect(viaMatrix).toEqual(viaPure);
  });
});

describe('deriveConstraints', () => {
  it('accumulates greens, presents, and absents across turns', () => {
    // guess crane vs answer crate
    const guess = 'crane';
    const answer = 'crate';
    const feedback = computeFeedback(guess, answer);
    const history: Pick<PlayedTurn, 'guess' | 'feedback'>[] = [{ guess, feedback }];
    const c = deriveConstraints(history);

    // c,r are greens at 0,1; a is green at 2? crane=c r a n e, crate=c r a t e
    // pos0 c==c green; pos1 r==r green; pos2 a==a green; pos3 n vs t absent;
    // pos4 e==e green.
    expect(c.greens[0]).toBe(letterCode('c'));
    expect(c.greens[1]).toBe(letterCode('r'));
    expect(c.greens[2]).toBe(letterCode('a'));
    expect(c.greens[4]).toBe(letterCode('e'));
    expect(c.greenCount).toBe(4);
    // n is absent (never appears present anywhere)
    expect(c.absentLetters.has(letterCode('n'))).toBe(true);
    // present letters include the greens
    expect(c.presentLetters.has(letterCode('c'))).toBe(true);
  });

  it('does not mark a letter absent if it is present elsewhere (repeated letters)', () => {
    // answer "apple", guess "allee": one l present, one l absent.
    const guess = 'allee';
    const answer = 'apple';
    const feedback = computeFeedback(guess, answer);
    const c = deriveConstraints([{ guess, feedback }]);
    // 'l' is present (one copy) -> must NOT be in absentLetters despite a gray l.
    expect(c.presentLetters.has(letterCode('l'))).toBe(true);
    expect(c.absentLetters.has(letterCode('l'))).toBe(false);
  });
});
