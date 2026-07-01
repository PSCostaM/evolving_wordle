// Baseline comparison: run the evolved champion and the baseline bots over a
// shared validation sample and compare win rate, avg guesses, failures, and the
// full 1..6 solved distribution.

import { useState } from 'react';
import { FeatureWeights } from '../engine/types';
import { BaselineKey } from '../ga/fitness';
import { BaselineSummary } from '../workers/protocol';
import { Card, fmt, pct } from './primitives';

const KEYS: BaselineKey[] = ['random', 'frequency', 'candidate', 'entropy'];

// green (fast) -> amber (slow), then red for failures.
const DIST_COLORS = ['#f87171', '#22c55e', '#4ade80', '#a3e635', '#facc15', '#fb923c', '#f97316'];

export function BaselineComparison({
  runBaselines,
  championWeights,
  sampleSize,
}: {
  runBaselines: (
    sampleSize: number,
    keys: BaselineKey[],
    championWeights?: FeatureWeights,
  ) => Promise<BaselineSummary[]>;
  championWeights: FeatureWeights | null;
  sampleSize: number;
}) {
  const [results, setResults] = useState<BaselineSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    const r = await runBaselines(sampleSize, KEYS, championWeights ?? undefined);
    // Champion first, then baselines by win rate.
    r.sort((a, b) => (a.key === 'champion' ? -1 : b.key === 'champion' ? 1 : b.winRate - a.winRate));
    setResults(r);
    setLoading(false);
  };

  return (
    <Card
      title="Champion vs. baselines"
      subtitle={`Head-to-head over ${sampleSize} held-out words. Bars show the 1→6 solve distribution.`}
      right={
        <button className="lab-btn lab-btn-primary" onClick={run} disabled={loading}>
          {loading ? 'Running…' : 'Run comparison'}
        </button>
      }
    >
      {!results ? (
        <div className="flex h-40 items-center justify-center text-sm text-lab-muted">
          Run the comparison to see how far your bots have come.
        </div>
      ) : (
        <div className="space-y-2">
          {results.map((r) => (
            <div
              key={r.key}
              className={`rounded-lg border p-3 ${
                r.key === 'champion'
                  ? 'border-neon-cyan/50 bg-neon-cyan/5'
                  : 'border-lab-border/60 bg-lab-bg/30'
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-lab-text">
                  {r.key === 'champion' ? '👑 ' : ''}
                  {r.name}
                </span>
                <div className="flex gap-4 font-mono text-xs">
                  <span className="text-neon-lime">win {pct(r.winRate, 0)}</span>
                  <span className="text-neon-amber">avg {fmt(r.avgGuesses, 2)}</span>
                  <span className="text-neon-red">fail {r.failures}</span>
                </div>
              </div>
              <DistributionBar histogram={r.histogram} total={r.games} />
            </div>
          ))}
          <Legend />
        </div>
      )}
    </Card>
  );
}

function DistributionBar({ histogram, total }: { histogram: number[]; total: number }) {
  // histogram order: [fail, 1, 2, 3, 4, 5, 6] — render solved 1..6 first, fail last.
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="flex h-5 w-full overflow-hidden rounded bg-lab-bg">
      {order.map((idx) => {
        const count = histogram[idx] ?? 0;
        if (count === 0) return null;
        const width = (count / total) * 100;
        return (
          <div
            key={idx}
            className="flex items-center justify-center text-[10px] font-medium text-slate-950"
            style={{ width: `${width}%`, background: DIST_COLORS[idx] }}
            title={`${idx === 0 ? 'failed' : `solved in ${idx}`}: ${count}`}
          >
            {width > 6 ? (idx === 0 ? '✗' : idx) : ''}
          </div>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] text-lab-muted">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DIST_COLORS[i] }} />
          {i}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DIST_COLORS[0] }} />
        fail
      </span>
    </div>
  );
}
