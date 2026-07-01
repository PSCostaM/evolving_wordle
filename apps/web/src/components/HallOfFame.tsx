// Hall of Fame: the best champions crowned this session. Click one to make it
// replay a random word on the live board.

import { ChampionInfo } from '../ga/evolution';
import { Card, fmt, pct } from './primitives';

export function HallOfFame({
  hallOfFame,
  onReplay,
}: {
  hallOfFame: ChampionInfo[];
  onReplay: (champion: ChampionInfo) => void;
}) {
  return (
    <Card
      title="Hall of Fame"
      subtitle="Record-breaking champions from this session. Click to replay."
    >
      {hallOfFame.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-lab-muted">
          Every new record lands here.
        </div>
      ) : (
        <ol className="space-y-2">
          {hallOfFame.map((champ, i) => (
            <li key={`${champ.chromosome.id}-${i}`}>
              <button
                onClick={() => onReplay(champ)}
                className="group flex w-full items-center gap-3 rounded-lg border border-lab-border/60 bg-lab-bg/30 px-3 py-2 text-left transition hover:border-neon-cyan/60 hover:bg-neon-cyan/5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lab-panel2 font-mono text-xs text-neon-amber">
                  {i === 0 ? '🥇' : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-lab-text">
                    {champ.nickname}
                  </span>
                  <span className="block font-mono text-[10px] text-lab-muted">
                    {champ.chromosome.id} · born gen {champ.chromosome.generationBorn}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-sm text-neon-green">
                    {fmt(champ.fitness, 0)}
                  </span>
                  <span className="block text-[10px] text-lab-muted">
                    {pct(champ.stats.winRate, 0)} · {fmt(champ.stats.avgGuesses, 2)} avg
                  </span>
                </span>
                <span className="text-lab-muted opacity-0 transition group-hover:opacity-100">▶</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
