"""Letter- and positional-frequency helpers over the candidate answer set."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence


def letter_frequencies(candidates: Sequence[str]) -> dict[str, float]:
    """Fraction of candidates that contain each letter (presence frequency).

    Presence (per-word) rather than raw occurrence count so a letter appearing
    twice in one word does not double-count.
    """
    n = len(candidates)
    if n == 0:
        return {}
    counts: Counter[str] = Counter()
    for word in candidates:
        for letter in set(word):
            counts[letter] += 1
    return {letter: c / n for letter, c in counts.items()}


def positional_frequencies(candidates: Sequence[str]) -> list[dict[str, float]]:
    """For each of the 5 positions, the fraction of candidates with each letter."""
    n = len(candidates)
    per_pos: list[Counter[str]] = [Counter() for _ in range(5)]
    if n == 0:
        return [{} for _ in range(5)]
    for word in candidates:
        for i, letter in enumerate(word):
            per_pos[i][letter] += 1
    return [{letter: c / n for letter, c in pos.items()} for pos in per_pos]


def letter_frequency_score(guess: str, freqs: dict[str, float]) -> float:
    """Sum of presence-frequencies of the guess's DISTINCT letters."""
    return sum(freqs.get(letter, 0.0) for letter in set(guess))


def positional_frequency_score(guess: str, pos_freqs: list[dict[str, float]]) -> float:
    """Sum over positions of the frequency of the guess's letter at that spot."""
    return sum(pos_freqs[i].get(letter, 0.0) for i, letter in enumerate(guess))
