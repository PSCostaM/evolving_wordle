// Explainability: for each turn the champion played, show WHY it chose that
// word — the score, the runner-up guesses, and each heuristic's contribution.

import { useEffect, useState } from 'react';
import { FEATURE_META, FEATURE_ORDER } from '../engine/types';
import { ReplayMatch } from '../workers/protocol';
import { Card, fmt } from './primitives';

export function ExplainabilityPanel({ match }: { match: ReplayMatch | null }) {
  const [turnIndex, setTurnIndex] = useState(0);

  useEffect(() => {
    setTurnIndex(0);
  }, [match]);

  if (!match || match.turns.length === 0 || !match.turns[0].decision) {
    return (
      <Card title="Why did it guess that?" subtitle="Peek inside the champion's head.">
        <div className="flex h-40 items-center justify-center text-sm text-lab-muted">
          Run the champion (auto-plays while evolving) to inspect its reasoning.
        </div>
      </Card>
    );
  }

  const turn = match.turns[Math.min(turnIndex, match.turns.length - 1)];
  const decision = turn.decision!;
  const maxWeighted = Math.max(
    1,
    ...FEATURE_ORDER.map((f) => Math.abs(decision.weightedBreakdown[f] ?? 0)),
  );

  return (
    <Card
      title="Why did it guess that?"
      subtitle={`Target: ${match.answer.toUpperCase()} · ${match.solved ? `solved in ${match.guessCount}` : 'failed'}`}
    >
      {/* turn selector */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {match.turns.map((t, i) => (
          <button
            key={i}
            onClick={() => setTurnIndex(i)}
            className={`rounded-md border px-2.5 py-1 font-mono text-xs uppercase tracking-wider transition ${
              i === turnIndex
                ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                : 'border-lab-border text-lab-muted hover:border-neon-cyan/50'
            }`}
          >
            {t.guess}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Decision + alternatives */}
        <div>
          <div className="mb-2 rounded-lg border border-neon-cyan/40 bg-neon-cyan/5 p-3">
            <div className="lab-heading">Chosen guess</div>
            <div className="font-mono text-2xl font-bold uppercase tracking-widest text-neon-cyan">
              {decision.guess}
            </div>
            <div className="text-xs text-lab-muted">
              total score {fmt(decision.score, 3)} · {turn.candidatesBefore} candidates before,{' '}
              {turn.candidatesAfter} after
            </div>
          </div>

          <div className="lab-heading mb-1">Top alternatives it rejected</div>
          <div className="space-y-1">
            {decision.topCandidates.map((c, i) => (
              <div
                key={`${c.word}-${i}`}
                className="flex items-center justify-between rounded-md border border-lab-border/50 bg-lab-bg/30 px-2.5 py-1.5 text-xs"
              >
                <span className="font-mono uppercase tracking-widest text-lab-text">{c.word}</span>
                <span className="font-mono text-lab-muted">{fmt(c.score, 3)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Feature contributions */}
        <div>
          <div className="lab-heading mb-2">Heuristic contributions (weight × feature)</div>
          <div className="space-y-1">
            {FEATURE_ORDER.map((f) => {
              const contrib = decision.weightedBreakdown[f] ?? 0;
              const raw = decision.features[f] ?? 0;
              const positive = contrib >= 0;
              return (
                <div
                  key={f}
                  className="flex items-center gap-2 text-[11px]"
                  title={FEATURE_META[f].blurb}
                >
                  <span className="w-32 shrink-0 truncate text-lab-muted">
                    {FEATURE_META[f].label}
                  </span>
                  <div className="relative h-3 flex-1 overflow-hidden rounded bg-lab-bg">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-lab-border" />
                    <div
                      className={`absolute inset-y-0 ${positive ? 'left-1/2 bg-neon-green/70' : 'right-1/2 bg-neon-red/70'}`}
                      style={{ width: `${(Math.abs(contrib) / maxWeighted) * 50}%` }}
                    />
                  </div>
                  <span className="w-10 text-right font-mono text-lab-muted">{fmt(raw, 2)}</span>
                  <span
                    className={`w-12 text-right font-mono ${positive ? 'text-neon-green' : 'text-neon-red'}`}
                  >
                    {contrib >= 0 ? '+' : ''}
                    {fmt(contrib, 2)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-end gap-3 text-[10px] text-lab-muted">
            <span>raw feature</span>
            <span>weighted</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
