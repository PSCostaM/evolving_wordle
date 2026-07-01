"""Reading/writing experiment artifacts.

Every artifact file is camelCase JSON (the frontend contract). A run is written
to both ``artifacts/latest/`` and a timestamped ``artifacts/runs/{run_id}/``.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import orjson

# The five artifact filenames.
CHAMPION_FILE = "champion.json"
HISTORY_FILE = "generation_history.json"
REPLAY_FILE = "replay_samples.json"
BASELINE_FILE = "baseline_comparison.json"
SUMMARY_FILE = "experiment_summary.json"


def artifacts_dir() -> Path:
    """Location of the artifacts directory (override with ``WORDLE_ARTIFACTS_DIR``)."""
    override = os.environ.get("WORDLE_ARTIFACTS_DIR")
    if override:
        return Path(override)
    # .../trainer/src/wordle_evolution/io/artifacts.py -> trainer/artifacts
    return Path(__file__).resolve().parents[3] / "artifacts"


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(orjson.dumps(data, option=orjson.OPT_INDENT_2))


def _read_json(path: Path) -> Any:
    return orjson.loads(path.read_bytes())


def slugify(text: str, max_len: int = 32) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (slug or "run")[:max_len]


def make_run_id(seed: str, when: Optional[datetime] = None) -> str:
    """A filesystem-safe, sortable run id: ``YYYY-MM-DD_HHMMSS_slug``."""
    when = when or datetime.now(timezone.utc)
    date = when.strftime("%Y-%m-%d")
    time = when.strftime("%H%M%S")
    return f"{date}_{time}_{slugify(seed)}"


# --------------------------------------------------------------------------- #
# Saving
# --------------------------------------------------------------------------- #
def _write_bundle(
    target: Path,
    champion: dict,
    generation_history: list[dict],
    replay_samples: list[dict],
    baseline_comparison: list[dict],
    experiment_summary: dict,
) -> None:
    _write_json(target / CHAMPION_FILE, champion)
    _write_json(target / HISTORY_FILE, generation_history)
    _write_json(target / REPLAY_FILE, replay_samples)
    _write_json(target / BASELINE_FILE, baseline_comparison)
    _write_json(target / SUMMARY_FILE, experiment_summary)


def save_run(
    champion: dict,
    generation_history: list[dict],
    replay_samples: list[dict],
    baseline_comparison: list[dict],
    experiment_summary: dict,
    *,
    base_dir: Optional[Path] = None,
) -> str:
    """Persist a run to ``latest/`` and ``runs/{runId}/``. Returns the run id."""
    base = base_dir or artifacts_dir()
    run_id = experiment_summary.get("runId") or make_run_id(experiment_summary.get("seed", "run"))
    experiment_summary["runId"] = run_id

    latest_dir = base / "latest"
    run_dir = base / "runs" / run_id
    _write_bundle(
        latest_dir, champion, generation_history, replay_samples, baseline_comparison, experiment_summary
    )
    _write_bundle(
        run_dir, champion, generation_history, replay_samples, baseline_comparison, experiment_summary
    )
    return run_id


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #
def _load_bundle(directory: Path) -> Optional[dict]:
    summary_path = directory / SUMMARY_FILE
    if not summary_path.exists():
        return None
    return {
        "champion": _read_json(directory / CHAMPION_FILE),
        "generationHistory": _read_json(directory / HISTORY_FILE),
        "replaySamples": _read_json(directory / REPLAY_FILE),
        "baselineComparison": _read_json(directory / BASELINE_FILE),
        "experimentSummary": _read_json(summary_path),
    }


def load_latest(base_dir: Optional[Path] = None) -> Optional[dict]:
    base = base_dir or artifacts_dir()
    return _load_bundle(base / "latest")


def load_run(run_id: str, base_dir: Optional[Path] = None) -> Optional[dict]:
    base = base_dir or artifacts_dir()
    return _load_bundle(base / "runs" / run_id)


def list_runs(base_dir: Optional[Path] = None) -> list[dict]:
    """Return a summary row for each stored run, newest first."""
    base = base_dir or artifacts_dir()
    runs_dir = base / "runs"
    if not runs_dir.exists():
        return []
    rows: list[dict] = []
    for entry in sorted(runs_dir.iterdir(), reverse=True):
        summary_path = entry / SUMMARY_FILE
        if not (entry.is_dir() and summary_path.exists()):
            continue
        summary = _read_json(summary_path)
        rows.append(
            {
                "runId": summary.get("runId", entry.name),
                "timestamp": summary.get("timestamp"),
                "generations": summary.get("generations"),
                "seed": summary.get("seed"),
                "bestFitness": summary.get("bestFitness"),
            }
        )
    return rows
