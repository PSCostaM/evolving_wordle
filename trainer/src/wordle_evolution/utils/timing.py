"""Small timing helpers."""

from __future__ import annotations

import time


def now_ms() -> int:
    """Wall-clock milliseconds since the epoch (for timestamps/durations)."""
    return int(time.time() * 1000)


class Stopwatch:
    """Monotonic elapsed-time stopwatch, reporting whole milliseconds."""

    def __init__(self) -> None:
        self._start = time.perf_counter()

    def reset(self) -> None:
        self._start = time.perf_counter()

    def elapsed_ms(self) -> int:
        return int((time.perf_counter() - self._start) * 1000)

    def __enter__(self) -> "Stopwatch":
        self.reset()
        return self

    def __exit__(self, *exc: object) -> None:
        return None
