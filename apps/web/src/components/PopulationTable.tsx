// Sortable table of the current population — click a column header to sort.

import { useMemo, useState } from 'react';
import { PopulationMember } from '../ga/evolution';
import { Card, fmt, pct } from './primitives';

type SortKey = keyof Pick<
  PopulationMember,
  'fitness' | 'winRate' | 'avgGuesses' | 'mutationRate' | 'generationBorn' | 'distanceFromChampion'
>;

const COLUMNS: Array<{ key: SortKey; label: string; render: (m: PopulationMember) => string }> = [
  { key: 'fitness', label: 'Fitness', render: (m) => fmt(m.fitness, 0) },
  { key: 'winRate', label: 'Win %', render: (m) => pct(m.winRate, 0) },
  { key: 'avgGuesses', label: 'Avg', render: (m) => fmt(m.avgGuesses, 2) },
  { key: 'mutationRate', label: 'Mut', render: (m) => m.mutationRate.toFixed(3) },
  { key: 'generationBorn', label: 'Born', render: (m) => fmt(m.generationBorn) },
  { key: 'distanceFromChampion', label: 'Δ champ', render: (m) => m.distanceFromChampion.toFixed(3) },
];

export function PopulationTable({ population }: { population: PopulationMember[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('fitness');
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const sorted = [...population].sort((a, b) => a[sortKey] - b[sortKey]);
    if (!asc) sorted.reverse();
    return sorted;
  }, [population, sortKey, asc]);

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  };

  return (
    <Card
      title="Population"
      subtitle={`${population.length} bots · click a header to sort · Δ champ = cosine distance from the champion`}
    >
      {population.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-lab-muted">
          The gene pool is empty until you evolve.
        </div>
      ) : (
        <div className="max-h-80 overflow-auto rounded-lg border border-lab-border/60">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="sticky top-0 bg-lab-panel2 text-lab-muted">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Bot</th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="cursor-pointer select-none px-2 py-2 hover:text-neon-cyan"
                    onClick={() => toggle(col.key)}
                  >
                    {col.label}
                    {sortKey === col.key && <span>{asc ? ' ▲' : ' ▼'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => (
                <tr
                  key={m.id}
                  className={`border-t border-lab-border/40 ${i === 0 && !asc && sortKey === 'fitness' ? 'bg-neon-cyan/5' : ''}`}
                >
                  <td className="px-2 py-1.5 font-mono text-lab-muted">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <div className="font-medium text-lab-text">{m.nickname}</div>
                    <div className="font-mono text-[10px] text-lab-muted">{m.id}</div>
                  </td>
                  {COLUMNS.map((col) => (
                    <td key={col.key} className="px-2 py-1.5 font-mono">
                      {col.render(m)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
