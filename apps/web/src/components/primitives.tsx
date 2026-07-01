// Small, shared UI building blocks + formatting helpers used across panels.

import { ReactNode } from 'react';
import { FEATURE_ORDER, FeatureName, TileState } from '../engine/types';

export function Card({
  title,
  subtitle,
  right,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`lab-card p-4 sm:p-5 ${className}`}>
      {(title || right) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-lab-text">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-lab-muted">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  accent = 'text-lab-text',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-lab-border bg-lab-bg/40 px-3 py-2">
      <div className="lab-heading">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${accent}`}>{value}</div>
      {hint && <div className="text-[11px] text-lab-muted">{hint}</div>}
    </div>
  );
}

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`lab-chip ${className}`}>{children}</span>;
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-lab-bg ${className}`}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-green transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wordle tiles.
// ---------------------------------------------------------------------------

const TILE_LABELS: Record<TileState, string> = {
  correct: 'correct — right letter, right spot',
  present: 'present — right letter, wrong spot',
  absent: 'absent — letter not in the word',
};

export function Tile({
  letter,
  state,
  delayMs = 0,
  animate = true,
}: {
  letter?: string;
  state?: TileState;
  delayMs?: number;
  animate?: boolean;
}) {
  const base =
    'flex h-11 w-11 items-center justify-center rounded-md border text-lg font-bold uppercase sm:h-12 sm:w-12';
  let cls = 'border-lab-border bg-tile-empty/30 text-lab-muted';
  if (state === 'correct') cls = 'border-transparent bg-tile-correct text-white';
  else if (state === 'present') cls = 'border-transparent bg-tile-present text-white';
  else if (state === 'absent') cls = 'border-transparent bg-tile-absent text-white';

  return (
    <div
      className={`${base} ${cls} ${state && animate ? 'animate-tile-flip' : ''}`}
      style={state && animate ? { animationDelay: `${delayMs}ms` } : undefined}
      title={state ? TILE_LABELS[state] : undefined}
    >
      {letter ?? ''}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting.
// ---------------------------------------------------------------------------

export function fmt(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function pct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function bytesToMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Feature colors (stable per feature for charts + legends).
// ---------------------------------------------------------------------------

export const FEATURE_COLORS: Record<FeatureName, string> = {
  candidateBonus: '#22d3ee',
  entropyScore: '#a78bfa',
  expectedRemainingPenalty: '#f472b6',
  letterFrequencyScore: '#34d399',
  positionalFrequencyScore: '#a3e635',
  uniqueLetterBonus: '#38bdf8',
  duplicateLetterPenalty: '#fb7185',
  vowelCoverageScore: '#fbbf24',
  knownGreenBonus: '#4ade80',
  knownYellowBonus: '#facc15',
  knownAbsentPenalty: '#f87171',
  endgameCandidatePressure: '#e879f9',
};

export const ORDERED_FEATURES = FEATURE_ORDER;
