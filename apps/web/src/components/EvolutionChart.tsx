// Evolution charts (recharts): fitness over generations, and win-rate /
// avg-guesses over generations.

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { HistoryPoint } from '../hooks/useEvolution';
import { Card } from './primitives';

const AXIS = { stroke: '#7c8db5', fontSize: 11 };
const GRID = '#1e2b45';
const TOOLTIP_STYLE = {
  background: '#0d1424',
  border: '1px solid #1e2b45',
  borderRadius: 8,
  fontSize: 12,
  color: '#e6edff',
};

export function EvolutionChart({ history }: { history: HistoryPoint[] }) {
  const data = history.map((h) => ({
    gen: h.generation,
    best: round(h.bestFitness),
    avg: round(h.avgFitness),
    median: round(h.medianFitness),
    winRate: round(h.winRate * 100, 1),
    avgGuesses: round(h.avgGuesses, 3),
  }));

  return (
    <Card
      title="Evolution over generations"
      subtitle="Fitness climbs as dumb bots get less dumb. Win rate and guess count track real skill."
    >
      {data.length === 0 ? (
        <Empty />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartFrame label="Fitness (best · average · median)">
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="gen" tick={AXIS} stroke={GRID} />
              <YAxis tick={AXIS} stroke={GRID} width={54} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="best" stroke="#34d399" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="avg" stroke="#22d3ee" dot={false} strokeWidth={1.5} />
              <Line
                type="monotone"
                dataKey="median"
                stroke="#a78bfa"
                dot={false}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            </LineChart>
          </ChartFrame>

          <ChartFrame label="Champion win rate (%) · avg guesses">
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="gen" tick={AXIS} stroke={GRID} />
              <YAxis yAxisId="left" tick={AXIS} stroke={GRID} width={40} domain={[0, 100]} />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={AXIS}
                stroke={GRID}
                width={34}
                domain={[1, 6]}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="winRate"
                name="win %"
                stroke="#a3e635"
                dot={false}
                strokeWidth={2}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avgGuesses"
                name="avg guesses"
                stroke="#fbbf24"
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ChartFrame>
        </div>
      )}
    </Card>
  );
}

function ChartFrame({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <div className="rounded-lg border border-lab-border/60 bg-lab-bg/30 p-2">
      <div className="mb-1 px-1 text-[11px] font-medium text-lab-muted">{label}</div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-lab-border text-sm text-lab-muted">
      Hit “Start evolution” to watch the lines wake up.
    </div>
  );
}

function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
