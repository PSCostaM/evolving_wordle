"""Wordle feedback scoring and base-3 pattern encode/decode helpers.

The pattern computation is on the GA's hottest path (entropy estimation), so a
fast integer-only variant (:func:`pattern_for`) avoids ``Counter`` and string
allocation. :func:`score_guess` keeps the readable state-tuple contract.
"""

from __future__ import annotations

from functools import lru_cache

from .types import TileState

# Base-3 digit values used for pattern encoding.
_STATE_TO_DIGIT: dict[TileState, int] = {"absent": 0, "present": 1, "correct": 2}
_DIGIT_TO_STATE: tuple[TileState, ...] = ("absent", "present", "correct")


def score_guess(guess: str, answer: str) -> tuple[TileState, TileState, TileState, TileState, TileState]:
    """Return Wordle feedback for ``guess`` against ``answer`` (two-pass rule).

    Pass 1 marks exact-position matches (greens) and tallies the answer's
    remaining (unmatched) letters. Pass 2 walks left to right marking
    ``present`` only while that letter still has remaining count, decrementing on
    use; everything else is ``absent``. Extra duplicate guess letters therefore
    correctly become ``absent``.
    """
    if len(guess) != 5 or len(answer) != 5:
        raise ValueError("score_guess requires two 5-letter words")

    counts = [0] * 26
    result: list[int] = [0, 0, 0, 0, 0]

    # Pass 1: greens.
    for i in range(5):
        gi = guess[i]
        ai = answer[i]
        if gi == ai:
            result[i] = 2
        else:
            counts[ord(ai) - 97] += 1

    # Pass 2: presents / absents.
    for i in range(5):
        if result[i] == 2:
            continue
        c = ord(guess[i]) - 97
        if counts[c] > 0:
            result[i] = 1
            counts[c] -= 1

    return tuple(_DIGIT_TO_STATE[d] for d in result)  # type: ignore[return-value]


@lru_cache(maxsize=1 << 20)
def score_guess_cached(guess: str, answer: str) -> tuple[TileState, ...]:
    return score_guess(guess, answer)


@lru_cache(maxsize=1 << 22)
def pattern_for(guess: str, answer: str) -> int:
    """Encoded base-3 feedback pattern (0..242) for a guess/answer pair.

    Integer-only fast path used for entropy bucketing. Equivalent to
    ``encode_pattern(score_guess(guess, answer))`` but ~2-3x faster.
    """
    counts = [0] * 26
    result = [0, 0, 0, 0, 0]
    for i in range(5):
        gi = guess[i]
        ai = answer[i]
        if gi == ai:
            result[i] = 2
        else:
            counts[ord(ai) - 97] += 1
    code = 0
    for i in range(5):
        d = result[i]
        if d != 2:
            c = ord(guess[i]) - 97
            if counts[c] > 0:
                d = 1
                counts[c] -= 1
        code = code * 3 + d
    return code


def encode_pattern(feedback: tuple[TileState, ...] | list[TileState]) -> int:
    """Encode a 5-tile feedback tuple into a base-3 integer in ``0..242``.

    absent=0, present=1, correct=2. Position 0 is the most significant digit.
    """
    code = 0
    for state in feedback:
        code = code * 3 + _STATE_TO_DIGIT[state]
    return code


def decode_pattern(code: int) -> tuple[TileState, TileState, TileState, TileState, TileState]:
    """Inverse of :func:`encode_pattern`."""
    if not 0 <= code <= 242:
        raise ValueError(f"pattern code out of range: {code}")
    digits: list[TileState] = []
    for _ in range(5):
        digits.append(_DIGIT_TO_STATE[code % 3])
        code //= 3
    digits.reverse()
    return tuple(digits)  # type: ignore[return-value]
