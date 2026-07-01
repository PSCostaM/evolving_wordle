"""Entropy baseline: guess the candidate that maximizes feedback entropy."""

from __future__ import annotations

from ..features.entropy import shannon_entropy, subsample_candidates

KEY = "entropy"
NAME = "Entropy Bot"

_SUBSAMPLE_CAP = 64


def select(candidates: list[str], rng=None) -> str:
    """Candidate with the highest Shannon entropy over the candidate set.

    The candidate set is subsampled for the entropy estimate to stay tractable.
    Ties break lexicographically.
    """
    ordered = sorted(candidates)
    if len(ordered) == 1:
        return ordered[0]
    sample = subsample_candidates(ordered, _SUBSAMPLE_CAP)
    return max(ordered, key=lambda w: shannon_entropy(w, sample, 0))
