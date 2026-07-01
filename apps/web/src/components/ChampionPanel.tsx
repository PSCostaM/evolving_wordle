// The reigning champion: identity, stats, and a live breakdown of how its
// fitness score is assembled (so the formula is explained in the UI).

import { EvolutionConfig } from '../engine/types';
import { ChampionInfo } from '../ga/evolution';
import { fitnessBreakdown } from '../ga/fitness';
import { Card, Chip, Stat, fmt, pct } from './primitives';

export function ChampionPanel({
  champion,
  generation,
  config,
}: {
  champion: ChampionInfo | null;
  generation: number | null;
  config: EvolutionConfig;
}) {
  if (!champion) {
    return (
      <Card title="Champion" subtitle="The current pick of the litter.">
        <div className="flex h-40 items-center justify-center text-sm text-lab-muted">
          No champion yet — evolve a generation to crown one.
        </div>
      </Card>
    );
  }

  const c = champion.chromosome;
  const breakdown = fitnessBreakdown(champion.stats, config.fitness);

  return (
    <Card
      title="Champion"
      subtitle={`Best individual of generation ${generation ?? 0}`}
      right={<Chip className="text-neon-cyan">👑 The chosen bot</Chip>}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-lg bg-gradient-to-r from-neon-purple/20 to-neon-cyan/20 px-3 py-1 text-sm font-semibold text-neon-cyan">
          {champion.nickname}
        </span>
        <span className="font-mono text-xs text-lab-muted">{c.id}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Fitness" value={fmt(champion.fitness, 0)} accent="text-neon-green" />
        <Stat label="Win rate" value={pct(champion.stats.winRate)} accent="text-neon-lime" />
        <Stat label="Avg guesses" value={fmt(champion.stats.avgGuesses, 2)} accent="text-neon-amber" />
        <Stat label="Solved ≤3" value={pct(champion.stats.solvedIn3OrLessRate)} />
        <Stat label="Born gen" value={fmt(c.generationBorn)} />
        <Stat label="Mutation rate" value={c.mutationRate.toFixed(3)} />
      </div>

      <div className="mt-4 rounded-lg border border-lab-border/60 bg-lab-bg/30 p-3">
        <div className="lab-heading mb-2">Fitness breakdown</div>
        <div className="space-y-1.5">
          {breakdown.map((b) => (
            <div key={b.term} className="flex items-center gap-2 text-xs">
              <span className="w-40 shrink-0 text-lab-muted">{b.term}</span>
              <div className="relative h-3 flex-1 overflow-hidden rounded bg-lab-bg">
                <div
                  className={`absolute inset-y-0 ${b.value >= 0 ? 'left-1/2 bg-neon-green/70' : 'right-1/2 bg-neon-red/70'}`}
                  style={{ width: `${Math.min(50, (Math.abs(b.value) / maxAbs(breakdown)) * 50)}%` }}
                />
                <div className="absolute inset-y-0 left-1/2 w-px bg-lab-border" />
              </div>
              <span
                className={`w-16 text-right font-mono ${b.value >= 0 ? 'text-neon-green' : 'text-neon-red'}`}
              >
                {b.value >= 0 ? '+' : ''}
                {fmt(b.value, 0)}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-lab-muted">
          fitness = winRate·{config.fitness.winRateWeight} − avgGuesses·{config.fitness.avgGuessesWeight} −
          failureRate·{config.fitness.failureRateWeight} + solved≤3·{config.fitness.solvedIn3OrLessWeight} −
          remainingAfterGuess2·{config.fitness.remainingAfterGuess2Weight}
        </p>
      </div>
    </Card>
  );
}

function maxAbs(items: Array<{ value: number }>): number {
  return Math.max(1, ...items.map((i) => Math.abs(i.value)));
}
