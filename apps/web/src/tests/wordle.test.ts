import { describe, expect, it } from 'vitest';
import {
  computeFeedback,
  decodePattern,
  encodePattern,
  patternFromCodes,
  patternOf,
  wordToCodes,
} from '../engine/wordle';
import { TileState, WIN_PATTERN } from '../engine/types';

const fb = (guess: string, answer: string): TileState[] => computeFeedback(guess, answer);

describe('computeFeedback — basics', () => {
  it('marks an exact match as all correct', () => {
    expect(fb('crane', 'crane')).toEqual([
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
    ]);
  });

  it('marks entirely-wrong letters as absent', () => {
    expect(fb('fghij', 'crane')).toEqual(['absent', 'absent', 'absent', 'absent', 'absent']);
  });

  it('marks present letters that exist elsewhere', () => {
    // "slate" vs "least": s,l,a,t,e all present but only 'a' shares a position? no.
    // Use a clear case: guess "aisle" answer "least"
    const f = fb('aisle', 'least');
    // a: in least, not pos0 -> present
    // i: not in least -> absent
    // s: in least, not pos2 -> present
    // l: in least, not pos3 -> present
    // e: in least, not pos4 -> present
    expect(f).toEqual(['present', 'absent', 'present', 'present', 'present']);
  });
});

describe('computeFeedback — repeated letters', () => {
  it('handles the canonical apple/allee case (counts respected)', () => {
    // answer apple (a p p l e), guess allee (a l l e e)
    // pos0 a correct; pos4 e correct; one 'l' present, the extra 'l' + 'e' absent
    expect(fb('allee', 'apple')).toEqual([
      'correct',
      'present',
      'absent',
      'absent',
      'correct',
    ]);
  });

  it('does not over-report presents when the guess repeats a rare letter', () => {
    // answer "abide" has one 'a'. guess "aaaaa" -> only pos0 correct, rest absent.
    expect(fb('aaaaa', 'abide')).toEqual([
      'correct',
      'absent',
      'absent',
      'absent',
      'absent',
    ]);
  });

  it('greens consume a letter before yellows can', () => {
    // answer "eerie" has three e. guess "genie": e(0) present? answer[0]=e so correct.
    // g absent, n absent, i correct(answer[3]=i), e(4) correct(answer[4]=e)
    // answer eerie = e e r i e
    // guess genie = g e n i e
    // pos0 g vs e -> absent (count e)
    // pos1 e vs e -> correct
    // pos2 n vs r -> absent (count r)
    // pos3 i vs i -> correct
    // pos4 e vs e -> correct
    expect(fb('genie', 'eerie')).toEqual([
      'absent',
      'correct',
      'absent',
      'correct',
      'correct',
    ]);
  });

  it('assigns present to the first occurrence when only one copy exists', () => {
    // answer "abcde"(not real, but function is pure) guess "eebca"
    // We only need count semantics, not dictionary validity.
    // answer: a b c d e ; guess: e e b c a
    // pos0 e vs a absent? count a. pos1 e vs b -> count b. pos2 b vs c -> count c.
    // pos3 c vs d -> count d. pos4 a vs e -> count e.
    // counts: a,b,c,d,e each 1.
    // pass2: pos0 e -> present(consume e); pos1 e -> no e left -> absent;
    //        pos2 b -> present; pos3 c -> present; pos4 a -> present
    expect(fb('eebca', 'abcde')).toEqual([
      'present',
      'absent',
      'present',
      'present',
      'present',
    ]);
  });
});

describe('pattern encoding', () => {
  it('round-trips feedback <-> integer', () => {
    const samples = ['allee', 'crane', 'aaaaa', 'slate'];
    for (const g of samples) {
      const f = computeFeedback(g, 'apple');
      const p = encodePattern(f);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(243);
      expect(decodePattern(p)).toEqual(f);
    }
  });

  it('the all-correct pattern is WIN_PATTERN (242)', () => {
    expect(encodePattern(computeFeedback('crane', 'crane'))).toBe(WIN_PATTERN);
  });
});

describe('patternFromCodes matches the string implementation', () => {
  it('agrees on tricky repeated-letter cases', () => {
    const pairs: Array<[string, string]> = [
      ['allee', 'apple'],
      ['eerie', 'genie'],
      ['sassy', 'strut'],
      ['mamma', 'madam'],
      ['array', 'radar'],
      ['llama', 'kayak'],
    ];
    const counts = new Int8Array(26);
    for (const [guess, answer] of pairs) {
      const gCodes = new Uint8Array(5);
      const aCodes = new Uint8Array(5);
      wordToCodes(guess, gCodes, 0);
      wordToCodes(answer, aCodes, 0);
      const fast = patternFromCodes(gCodes, 0, aCodes, 0, counts);
      expect(fast).toBe(patternOf(guess, answer));
    }
  });
});
