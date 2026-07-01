"""Load two stored runs and print a side-by-side comparison table."""

from __future__ import annotations

import argparse

from ..io.artifacts import load_run


def _summary_metrics(bundle: dict) -> dict:
    summary = bundle["experimentSummary"]
    champ = bundle["champion"]
    stats = champ["stats"]
    return {
        "runId": summary.get("runId"),
        "seed": summary.get("seed"),
        "generations": summary.get("generations"),
        "bestFitness": summary.get("bestFitness"),
        "nickname": champ.get("nickname"),
        "winRate": stats.get("winRate"),
        "avgGuesses": stats.get("avgGuesses"),
        "solvedIn3OrLessRate": stats.get("solvedIn3OrLessRate"),
        "hardWordSuccessRate": stats.get("hardWordSuccessRate"),
    }


def compare(run_a: str, run_b: str) -> None:
    from rich.console import Console
    from rich.table import Table

    console = Console()
    bundle_a = load_run(run_a)
    bundle_b = load_run(run_b)
    if bundle_a is None or bundle_b is None:
        missing = run_a if bundle_a is None else run_b
        console.print(f"[red]Run not found:[/] {missing}")
        return

    ma = _summary_metrics(bundle_a)
    mb = _summary_metrics(bundle_b)

    table = Table(title="Run comparison", show_header=True, header_style="bold")
    table.add_column("metric")
    table.add_column(run_a)
    table.add_column(run_b)
    for key in ma:
        va, vb = ma[key], mb[key]
        va_s = f"{va:.3f}" if isinstance(va, float) else str(va)
        vb_s = f"{vb:.3f}" if isinstance(vb, float) else str(vb)
        table.add_row(key, va_s, vb_s)
    console.print(table)


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(prog="compare_runs", description="Compare two runs.")
    parser.add_argument("run_a")
    parser.add_argument("run_b")
    args = parser.parse_args(argv)
    compare(args.run_a, args.run_b)


if __name__ == "__main__":
    main()
