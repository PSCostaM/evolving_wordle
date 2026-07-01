// The control deck: lifecycle buttons, training knobs, and custom word-list
// import. Structural changes (population, sample size, seed, fast mode) rebuild
// the engine; tuning knobs (mutation, elite, tournament, generations, entropy)
// apply live.

import { useState } from 'react';
import { EvolutionConfig } from '../engine/types';
import { EvolutionState } from '../hooks/useEvolution';
import { validateImport } from '../data/wordlists';
import { Card, ProgressBar } from './primitives';

type Actions = {
  initialize: (config: EvolutionConfig, lists?: { answers: string[]; guesses: string[] }) => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stepOne: () => void;
  stop: () => void;
  reset: () => void;
  updateConfig: (patch: Partial<EvolutionConfig>) => void;
  runChampionMatch: (answer?: string) => void;
};

export function ControlPanel({ state, actions }: { state: EvolutionState; actions: Actions }) {
  const { status, config } = state;
  const running = status === 'running';
  const busy = status === 'initializing';
  const ready = status === 'ready' || status === 'paused' || status === 'done';

  // Structural form fields (require a rebuild to take effect).
  const [popSize, setPopSize] = useState(config.populationSize);
  const [sampleSize, setSampleSize] = useState(config.trainingSampleSize);
  const [seed, setSeed] = useState(config.seed);
  const [fastMode, setFastMode] = useState(config.fastMode);
  const structuralDirty =
    popSize !== config.populationSize ||
    sampleSize !== config.trainingSampleSize ||
    seed !== config.seed ||
    fastMode !== config.fastMode;

  const rebuild = () => {
    actions.initialize({
      ...config,
      populationSize: clampInt(popSize, 4, 400),
      trainingSampleSize: clampInt(sampleSize, 10, state.info?.answerCount ?? 2315),
      seed: seed.trim() || 'codebullet-wordle',
      fastMode,
    });
  };

  return (
    <Card
      title="Control panel"
      subtitle="Evolve, pause, poke, and rebuild your bots."
      right={<StatusPill status={status} />}
    >
      {/* Lifecycle buttons */}
      <div className="mb-4 flex flex-wrap gap-2">
        {running ? (
          <button className="lab-btn lab-btn-primary" onClick={actions.pause}>
            ⏸ Pause
          </button>
        ) : status === 'paused' ? (
          <button className="lab-btn lab-btn-primary" onClick={actions.resume} disabled={busy}>
            ▶ Resume
          </button>
        ) : (
          <button
            className="lab-btn lab-btn-primary"
            onClick={actions.start}
            disabled={!ready || busy || structuralDirty}
            title={structuralDirty ? 'Rebuild to apply structural changes first' : undefined}
          >
            ▶ Start evolution
          </button>
        )}
        <button className="lab-btn" onClick={actions.stepOne} disabled={running || !ready}>
          ⏭ Step 1 gen
        </button>
        <button className="lab-btn" onClick={actions.reset} disabled={!state.info || busy}>
          ↺ Reset
        </button>
        <button
          className="lab-btn"
          onClick={() => actions.runChampionMatch()}
          disabled={!state.latest}
        >
          🎲 Champion on random word
        </button>
      </div>

      {(running || status === 'paused') && state.genProgress && (
        <GenerationProgress progress={state.genProgress} paused={status === 'paused'} />
      )}

      {structuralDirty && (
        <button className="lab-btn lab-btn-primary mb-4 w-full" onClick={rebuild} disabled={busy}>
          ⚙ Rebuild engine to apply structural changes
        </button>
      )}

      {/* Structural knobs */}
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Population size" value={popSize} min={4} max={400} onChange={setPopSize} />
        <NumberField
          label="Training sample"
          value={sampleSize}
          min={10}
          max={state.info?.answerCount ?? 2315}
          onChange={setSampleSize}
        />
        <label className="col-span-2 block">
          <span className="lab-heading">Random seed</span>
          <input
            className="lab-input mt-1"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="codebullet-wordle"
          />
        </label>
      </div>

      {/* Toggles */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Toggle
          label="Fast mode"
          hint={fastMode ? 'sampled entropy (rebuild)' : 'exact entropy (rebuild)'}
          on={fastMode}
          onChange={setFastMode}
        />
        <Toggle
          label="Entropy feature"
          hint={config.useEntropy ? 'on (live)' : 'off (live)'}
          on={config.useEntropy}
          onChange={(v) => actions.updateConfig({ useEntropy: v })}
        />
      </div>

      {/* Live tuning knobs */}
      <div className="mt-4 space-y-3 border-t border-lab-border/60 pt-4">
        <div className="lab-heading">Live tuning (applies immediately)</div>
        <Slider
          label="Mutation rate"
          value={config.mutationRate}
          min={0}
          max={0.8}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(v) => actions.updateConfig({ mutationRate: v })}
        />
        <Slider
          label="Elite count"
          value={config.eliteCount}
          min={0}
          max={Math.min(20, config.populationSize)}
          step={1}
          format={(v) => String(v)}
          onChange={(v) => actions.updateConfig({ eliteCount: Math.round(v) })}
        />
        <Slider
          label="Tournament size"
          value={config.tournamentSize}
          min={2}
          max={Math.min(12, config.populationSize)}
          step={1}
          format={(v) => String(v)}
          onChange={(v) => actions.updateConfig({ tournamentSize: Math.round(v) })}
        />
        <Slider
          label="Max generations"
          value={config.generations}
          min={5}
          max={300}
          step={1}
          format={(v) => String(v)}
          onChange={(v) => actions.updateConfig({ generations: Math.round(v) })}
        />
      </div>

      <ImportSection onImport={(answers, guesses) => actions.initialize(config, { answers, guesses })} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-widgets.
// ---------------------------------------------------------------------------

function StatusPill({ status }: { status: EvolutionState['status'] }) {
  const map: Record<EvolutionState['status'], { text: string; cls: string }> = {
    uninitialized: { text: 'idle', cls: 'text-lab-muted' },
    initializing: { text: 'warming up…', cls: 'text-neon-amber animate-pulse-glow' },
    ready: { text: 'ready', cls: 'text-neon-cyan' },
    running: { text: 'evolving', cls: 'text-neon-green animate-pulse-glow' },
    paused: { text: 'paused', cls: 'text-neon-amber' },
    done: { text: 'finished', cls: 'text-neon-purple' },
    error: { text: 'error', cls: 'text-neon-red' },
  };
  const m = map[status];
  return <span className={`lab-chip ${m.cls}`}>● {m.text}</span>;
}

function GenerationProgress({
  progress,
  paused,
}: {
  progress: NonNullable<EvolutionState['genProgress']>;
  paused: boolean;
}) {
  const { generation, evaluated, total } = progress;
  const ratio = total > 0 ? evaluated / total : 0;
  return (
    <div className="mb-4 rounded-lg border border-lab-border/60 bg-lab-bg/40 p-3">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="lab-heading">
          {paused ? 'Paused mid-generation' : 'Evaluating'} generation {generation}
        </span>
        <span className="font-mono text-neon-cyan">
          {evaluated}/{total} bots
        </span>
      </div>
      <ProgressBar value={ratio} />
      <div className="mt-1 text-[11px] text-lab-muted">
        Scoring the population against the shared answer sample — the chart updates when the
        generation finishes.
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="lab-heading">{label}</span>
      <input
        type="number"
        className="lab-input mt-1"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(clampInt(Number(e.target.value), min, max))}
      />
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between">
        <span className="lab-heading">{label}</span>
        <span className="font-mono text-xs text-neon-cyan">{format(value)}</span>
      </div>
      <input
        type="range"
        className="mt-1 w-full accent-neon-cyan"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
        on ? 'border-neon-cyan/60 bg-neon-cyan/10' : 'border-lab-border bg-lab-bg/40'
      }`}
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-[11px] text-lab-muted">{hint}</span>}
      </span>
      <span
        className={`ml-2 flex h-5 w-9 items-center rounded-full p-0.5 transition ${
          on ? 'bg-neon-cyan' : 'bg-lab-border'
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white transition ${on ? 'translate-x-4' : ''}`}
        />
      </span>
    </button>
  );
}

function ImportSection({ onImport }: { onImport: (answers: string[], guesses: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState('');
  const [guesses, setGuesses] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const doImport = () => {
    const result = validateImport(answers, guesses);
    setMessage(result.message);
    setOk(result.ok);
    if (result.ok) onImport(result.answers, result.guesses);
  };

  return (
    <div className="mt-4 border-t border-lab-border/60 pt-4">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="lab-heading">Import custom word lists</span>
        <span className="text-lab-muted">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-lab-muted">
            Paste 5-letter words (space, comma, or newline separated). Invalid tokens are skipped;
            answers are auto-added to the guess list.
          </p>
          <textarea
            className="lab-input h-20 font-mono text-xs"
            placeholder="answers: crane slate about ..."
            value={answers}
            onChange={(e) => setAnswers(e.target.value)}
          />
          <textarea
            className="lab-input h-20 font-mono text-xs"
            placeholder="extra valid guesses: aahed aalii ..."
            value={guesses}
            onChange={(e) => setGuesses(e.target.value)}
          />
          <button className="lab-btn w-full" onClick={doImport}>
            Import &amp; rebuild
          </button>
          {message && (
            <p className={`text-xs ${ok ? 'text-neon-green' : 'text-neon-red'}`}>{message}</p>
          )}
        </div>
      )}
    </div>
  );
}

function clampInt(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(x)));
}
