"""Word-list loading and validation.

The answer/guess lists already exist as text files shipped inside this package
(``wordle/data/answers.txt`` and ``wordle/data/guesses.txt``). They are loaded
once at import time, validated against ``^[a-z]{5}$``, and the answer set is
guaranteed to be a subset of the guess set.
"""

from __future__ import annotations

import re
from importlib import resources

_WORD_RE = re.compile(r"^[a-z]{5}$")


def _load_list(filename: str) -> list[str]:
    """Read and validate a newline/whitespace separated word file from data/."""
    data_pkg = resources.files(__package__).joinpath("data")
    text = data_pkg.joinpath(filename).read_text(encoding="utf-8")
    words: list[str] = []
    for raw in text.split():
        word = raw.strip().lower()
        if not word:
            continue
        if not _WORD_RE.fullmatch(word):
            raise ValueError(f"invalid word {word!r} in {filename}")
        words.append(word)
    return words


def _build_lists() -> tuple[tuple[str, ...], tuple[str, ...]]:
    answers = _load_list("answers.txt")
    guesses = _load_list("guesses.txt")

    guess_set = set(guesses)
    # Ensure answers subset of guesses (a valid answer must also be guessable).
    missing = [w for w in answers if w not in guess_set]
    if missing:
        # Repair rather than crash: extend the guess list with any strays.
        guesses = guesses + missing
        guess_set.update(missing)

    return tuple(answers), tuple(guesses)


ANSWERS, GUESSES = _build_lists()

_ANSWER_SET = frozenset(ANSWERS)
_GUESS_SET = frozenset(GUESSES)


def is_answer(word: str) -> bool:
    """True if ``word`` is in the official answer list."""
    return word in _ANSWER_SET


def is_valid_guess(word: str) -> bool:
    """True if ``word`` is an accepted guess."""
    return word in _GUESS_SET


def default_word_lists() -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Return ``(ANSWERS, GUESSES)`` as immutable tuples."""
    return ANSWERS, GUESSES
