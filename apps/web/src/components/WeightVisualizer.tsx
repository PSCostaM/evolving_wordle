// Weight visualizer: a signed bar chart of the champion's current heuristic
// weights, plus a line chart of how those weights drifted over generations.

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { FEATURE_META, FEATURE_ORDER, FeatureWeights } from '../engine/types';
import { WeightSnapshot } from '../hooks/useEvolution';
import { Card, FEATURE_COLORS } from './primitives';

const CLAMP = 10;

export function WeightVisualizer({
  weights,
  weightHistory,
}: {
  weights: FeatureWeights | null;
  weightHistory: WeightSnapshot[];
}) {
  return (
    <Card
      title="Heuristic weights"
      subtitle="Green = the bot values this. Red = it avoids it. Evolution tunes all 12 together."
    >
      {!weights ? (
        <div className="flex h-40 items-center justify-center text-sm text-lab-muted">
          Weights appear once a champion exists.
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {FEATURE_ORDER.map((f) => (
              <WeightBar key={f} feature={f} value={weights[f]} />
            ))}
          </div>

          {weightHistory.length > 1 && (
            <div className="mt-4">
              <div className="lab-heading mb-1">Weights over generations</div>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={weightHistory.map((s) => ({ gen: s.generation, ...s.weights }))}
                    margin={{ top: 6, right: 8, bottom: 0, left: -12 }}
                  >
                    <CartesianGrid stroke="#1e2b45" strokeDasharray="3 3" />
                    <XAxis dataKey="gen" tick={{ stroke: '#7c8db5', fontSize: 11 }} stroke="#1e2b45" />
                    <YAxis tick={{ stroke: '#7c8db5', fontSize: 11 }} stroke="#1e2b45" width={40} />
                    <Tooltip
                      contentStyle={{
                        background: '#0d1424',
                        border: '1px solid #1e2b45',
                        borderRadius: 8,
                        fontSize: 11,
                        color: '#e6edff',
                      }}
                    />
                    {FEATURE_ORDER.map((f) => (
                      <Line
                        key={f}
                        type="monotone"
                        dataKey={f}
                        stroke={FEATURE_COLORS[f]}
                        dot={false}
                        strokeWidth={1.25}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function WeightBar({ feature, value }: { feature: keyof typeof FEATURE_META; value: number }) {
  const clamped = Math.max(-CLAMP, Math.min(CLAMP, value));
  const widthPct = (Math.abs(clamped) / CLAMP) * 50;
  const positive = clamped >= 0;

  return (
    <div className="flex items-center gap-2 text-xs" title={FEATURE_META[feature].blurb}>
      <span className="w-36 shrink-0 truncate text-lab-muted">{FEATURE_META[feature].label}</span>
      <div className="relative h-4 flex-1 overflow-hidden rounded bg-lab-bg">
        <div className="absolute inset-y-0 left-1/2 w-px bg-lab-border" />
        <div
          className={`absolute inset-y-0 ${positive ? 'left-1/2' : 'right-1/2'}`}
          style={{
            width: `${widthPct}%`,
            background: positive ? '#34d399' : '#f87171',
            opacity: 0.85,
          }}
        />
      </div>
      <span
        className={`w-12 text-right font-mono ${positive ? 'text-neon-green' : 'text-neon-red'}`}
      >
        {value.toFixed(1)}
      </span>
    </div>
  );
}
