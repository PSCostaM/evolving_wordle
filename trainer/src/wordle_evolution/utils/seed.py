"""Deterministic, reproducible RNG derived from a *string* seed.

Python's builtin ``hash`` is salted per-process, so it must never be used for
reproducible seeding. We derive integers from ``hashlib.sha256`` instead. The
same ``(seed, purpose, generation)`` triple always yields the same RNG stream.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass

import numpy as np


def derive_int(seed: str, purpose: str = "", generation: int = 0) -> int:
    """Derive a stable 64-bit integer from a string seed + purpose + generation."""
    key = f"{seed}|{purpose}|{generation}".encode("utf-8")
    digest = hashlib.sha256(key).digest()
    return int.from_bytes(digest[:8], "big")


def make_rng(seed: str, purpose: str = "", generation: int = 0) -> random.Random:
    """Build a stdlib ``random.Random`` seeded deterministically."""
    return random.Random(derive_int(seed, purpose, generation))


def make_numpy_rng(seed: str, purpose: str = "", generation: int = 0) -> np.random.Generator:
    """Build a numpy ``Generator`` (PCG64) seeded deterministically."""
    return np.random.Generator(np.random.PCG64(derive_int(seed, purpose, generation)))


@dataclass(frozen=True)
class SeedContext:
    """Bundles a base string seed with a current generation counter.

    Convenience for pulling multiple independent, reproducible RNG streams that
    differ only by ``purpose``.
    """

    seed: str
    generation: int = 0

    def rng(self, purpose: str) -> random.Random:
        return make_rng(self.seed, purpose, self.generation)

    def numpy_rng(self, purpose: str) -> np.random.Generator:
        return make_numpy_rng(self.seed, purpose, self.generation)

    def at_generation(self, generation: int) -> "SeedContext":
        return SeedContext(self.seed, generation)

    def derive(self, purpose: str) -> int:
        return derive_int(self.seed, purpose, self.generation)
