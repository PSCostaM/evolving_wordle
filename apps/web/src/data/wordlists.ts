// Word-list utilities: the default lists, validation, and custom-list import.

import { ANSWERS } from './answers';
import { GUESSES } from './guesses';

export const WORD_RE = /^[a-z]{5}$/;

export interface WordListPair {
  answers: string[];
  guesses: string[];
}

/** The built-in canonical Wordle lists. */
export function defaultWordLists(): WordListPair {
  return { answers: [...ANSWERS], guesses: [...GUESSES] };
}

export interface ParseResult {
  words: string[];
  invalid: string[];
  duplicates: number;
}

/**
 * Parse a pasted/imported blob into a clean list of 5-letter lowercase words.
 * Accepts words separated by whitespace, commas, or newlines.
 */
export function parseWordList(raw: string): ParseResult {
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);

  const seen = new Set<string>();
  const words: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;

  for (const t of tokens) {
    if (!WORD_RE.test(t)) {
      invalid.push(t);
      continue;
    }
    if (seen.has(t)) {
      duplicates++;
      continue;
    }
    seen.add(t);
    words.push(t);
  }

  return { words, invalid, duplicates };
}

export interface ImportValidation {
  ok: boolean;
  message: string;
  answers: string[];
  guesses: string[];
}

/**
 * Validate an imported answer + guess list. Guarantees:
 *  - both lists are non-empty and only contain 5-letter lowercase words
 *  - every answer is also a legal guess (answers ⊆ guesses); missing answers
 *    are auto-added to the guess list so the engine stays consistent.
 */
export function validateImport(rawAnswers: string, rawGuesses: string): ImportValidation {
  const a = parseWordList(rawAnswers);
  const g = parseWordList(rawGuesses);

  if (a.words.length === 0) {
    return fail('Answer list is empty (need at least one 5-letter word).', a, g);
  }
  if (g.words.length === 0) {
    return fail('Guess list is empty (need at least one 5-letter word).', a, g);
  }

  // Ensure answers ⊆ guesses.
  const guessSet = new Set(g.words);
  const merged = [...g.words];
  for (const w of a.words) {
    if (!guessSet.has(w)) {
      guessSet.add(w);
      merged.push(w);
    }
  }

  const parts: string[] = [];
  if (a.invalid.length) parts.push(`${a.invalid.length} invalid answer token(s) skipped`);
  if (g.invalid.length) parts.push(`${g.invalid.length} invalid guess token(s) skipped`);
  parts.push(`${a.words.length} answers, ${merged.length} guesses`);

  return {
    ok: true,
    message: parts.join(' · '),
    answers: a.words,
    guesses: merged.sort(),
  };
}

function fail(message: string, a: ParseResult, g: ParseResult): ImportValidation {
  return { ok: false, message, answers: a.words, guesses: g.words };
}
