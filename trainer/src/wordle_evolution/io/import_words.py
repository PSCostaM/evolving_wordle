"""Parsing and validating user-supplied word blobs."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..wordle.words import ANSWERS, GUESSES

_WORD_RE = re.compile(r"^[a-z]{5}$")
_SPLIT_RE = re.compile(r"[\s,]+")


def parse_word_blob(blob: str) -> list[str]:
    """Split a blob on whitespace/comma/newline and lowercase each token."""
    if not blob:
        return []
    return [tok.strip().lower() for tok in _SPLIT_RE.split(blob) if tok.strip()]


@dataclass
class ValidationResult:
    valid: list[str] = field(default_factory=list)
    invalid: list[str] = field(default_factory=list)


def validate_words(words) -> ValidationResult:
    """Partition words into those matching ``^[a-z]{5}$`` and those that don't.

    Accepts either a raw blob (str) or an iterable of tokens. Preserves order and
    de-duplicates the valid list while keeping first occurrences.
    """
    tokens = parse_word_blob(words) if isinstance(words, str) else [
        str(w).strip().lower() for w in words
    ]
    result = ValidationResult()
    seen: set[str] = set()
    for tok in tokens:
        if _WORD_RE.fullmatch(tok):
            if tok not in seen:
                seen.add(tok)
                result.valid.append(tok)
        else:
            result.invalid.append(tok)
    return result


@dataclass
class ImportResult:
    answers: list[str]
    guesses: list[str]
    added: int  # answer words that had to be added to the guess list


def import_word_lists(
    answers_blob: str | None = None,
    guesses_blob: str | None = None,
    *,
    base_answers=ANSWERS,
    base_guesses=GUESSES,
) -> ImportResult:
    """Build final word lists, guaranteeing answers is a subset of guesses.

    If either blob is omitted, the existing packaged list is used as the base.
    Any answer missing from the guess list is appended (``added`` counts these).
    """
    answers = validate_words(answers_blob).valid if answers_blob else list(base_answers)
    guesses = validate_words(guesses_blob).valid if guesses_blob else list(base_guesses)

    guess_set = set(guesses)
    added = 0
    for word in answers:
        if word not in guess_set:
            guesses.append(word)
            guess_set.add(word)
            added += 1

    return ImportResult(answers=answers, guesses=guesses, added=added)
