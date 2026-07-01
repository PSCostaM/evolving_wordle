"""Entropy / expected-remaining helpers over the possible-answer set.

Both quantities derive from the *feedback-pattern distribution* a guess induces
over the current candidate set, so we compute that distribution once and reuse
it. When the candidate set is large it is deterministically subsampled to keep
offline training tractable (the estimate stays representative).
"""

from __future__ import annotations

import hashlib
import math
from collections import Counter
from collections.abc import Sequence

from ..wordle.scoring import pattern_for


def _stable_key(word: str) -> bytes:
    return hashlib.sha256(word.encode("utf-8")).digest()


def subsample_candidates(candidates: Sequence[str], cap: int) -> list[str]:
    """Deterministically reduce ``candidates`` to at most ``cap`` words.

    Uses a stable hash-based ordering so the subset is pseudo-random (unbiased
    w.r.t. spelling) yet identical across runs.
    """
    if cap <= 0 or len(candidates) <= cap:
        return list(candidates)
    ordered = sorted(candidates, key=_stable_key)
    return ordered[:cap]


def pattern_distribution(
    guess: str,
    candidates: Sequence[str],
    subsample_cap: int = 0,
) -> Counter[int]:
    """Counter mapping encoded feedback pattern -> number of candidates.

    If ``subsample_cap > 0`` and there are more candidates than the cap, the
    candidate set is subsampled first.
    """
    pool = subsample_candidates(candidates, subsample_cap) if subsample_cap else list(candidates)
    dist: Counter[int] = Counter()
    for answer in pool:
        dist[pattern_for(guess, answer)] += 1
    return dist


def shannon_entropy_from_dist(dist: Counter[int]) -> float:
    """Shannon entropy (bits) of a pattern-count distribution."""
    total = sum(dist.values())
    if total <= 1:
        return 0.0
    entropy = 0.0
    for count in dist.values():
        if count <= 0:
            continue
        p = count / total
        entropy -= p * math.log2(p)
    return entropy


def expected_remaining_from_dist(dist: Counter[int]) -> float:
    """Expected number of remaining candidates: sum(bucket^2)/N."""
    total = sum(dist.values())
    if total <= 0:
        return 0.0
    return sum(count * count for count in dist.values()) / total


def shannon_entropy(guess: str, candidates: Sequence[str], subsample_cap: int = 0) -> float:
    return shannon_entropy_from_dist(pattern_distribution(guess, candidates, subsample_cap))


def expected_remaining(guess: str, candidates: Sequence[str], subsample_cap: int = 0) -> float:
    return expected_remaining_from_dist(pattern_distribution(guess, candidates, subsample_cap))
