// Match replay: pick a target word and watch the evolved champion play it
// side-by-side against the random / frequency / entropy baseline bots.

import { useEffect, useState } from 'react';
import { FeatureWeights } from '../engine/types';
import { BaselineKey } from '../ga/fitness';
import { ReplayMatch } from '../workers/protocol';
import { Card } from './primitives';
import { WordleBoard } from './WordleBoard';

type RunMatch = (params: {
  answer: string;
  label: string;
  botKind: 'champion' | BaselineKey;
  weights?: FeatureWeights;
  mutationRate?: number;
  baselineKey?: BaselineKey;
}) => Promise<ReplayMatch>;

const CONTENDERS: Array<{ label: string; botKind: 'champion' | BaselineKey; baselineKey?: BaselineKey }> = [
  { label: 'Evolved champion', botKind: 'champion' },
  { label: 'Entropy-heavy bot', botKind: 'entropy', baselineKey: 'entropy' },
  { label: 'Frequency bot', botKind: 'frequency', baselineKey: 'frequency' },
  { label: 'Random bot', botKind: 'random', baselineKey: 'random' },
];

export function MatchReplay({
  runMatch,
  championWeights,
  randomAnswer,
  isAnswer,
}: {
  runMatch: RunMatch;
  championWeights: FeatureWeights | null;
  randomAnswer: () => string;
  isAnswer: (w: string) => boolean;
}) {
  const [target, setTarget] = useState('');
  const [boards, setBoards] = useState<ReplayMatch[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!target) setTarget(randomAnswer());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valid = /^[a-z]{5}$/.test(target) && isAnswer(target);

  const run = async () => {
    if (!valid) return;
    setLoading(true);
    const results = await Promise.all(
      CONTENDERS.filter((c) => c.botKind !== 'champion' || championWeights).map((c) =>
        runMatch({
          answer: target,
          label: c.label,
          botKind: c.botKind,
          baselineKey: c.baselineKey,
          weights: c.botKind === 'champion' ? championWeights ?? undefined : undefined,
        }),
      ),
    );
    setBoards(results);
    setLoading(false);
  };

  return (
    <Card
      title="Match replay"
      subtitle="Same hidden word, four different brains. Who cracks it fastest?"
    >
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="lab-heading">Target word</span>
          <input
            className="lab-input mt-1 w-40 font-mono uppercase tracking-widest"
            value={target}
            maxLength={5}
            onChange={(e) => setTarget(e.target.value.toLowerCase().replace(/[^a-z]/g, ''))}
          />
        </label>
        <button className="lab-btn" onClick={() => setTarget(randomAnswer())}>
          🎲 Random
        </button>
        <button className="lab-btn lab-btn-primary" onClick={run} disabled={!valid || loading}>
          {loading ? 'Running…' : '▶ Run all bots'}
        </button>
        {!valid && target.length === 5 && (
          <span className="text-xs text-neon-amber">not in the answer list</span>
        )}
      </div>

      {boards.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-lab-muted">
          Pick a word and press run to line the bots up.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {boards.map((b) => (
            <BotBoard key={b.botKind} match={b} />
          ))}
        </div>
      )}
    </Card>
  );
}

function BotBoard({ match }: { match: ReplayMatch }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-lab-border/60 bg-lab-bg/30 p-3">
      <div className="text-center">
        <div className="text-sm font-semibold text-lab-text">{match.label}</div>
        <div
          className={`text-xs ${match.solved ? 'text-neon-green' : 'text-neon-red'}`}
        >
          {match.solved ? `solved in ${match.guessCount}` : 'failed (6/6)'}
        </div>
      </div>
      <WordleBoard
        turns={match.turns}
        animate
        compact
      />
    </div>
  );
}
