// Top control bar: backend connection status, the Live/Local/Artifact mode
// selector, artifact loading, champion export, and the "backend offline" banner.

import { useRef, useState } from 'react';
import { BackendStatus } from '../hooks/useBackend';
import { LabSource } from '../hooks/reportState';
import { PythonLab } from '../hooks/usePythonLab';

const MODES: Array<{ id: LabSource; label: string; blurb: string }> = [
  { id: 'live', label: '🐍 Live (Python)', blurb: 'Train on the FastAPI backend, streamed live.' },
  { id: 'local', label: '🧪 Local demo', blurb: 'Run the whole GA in your browser — no backend.' },
  { id: 'artifact', label: '📦 Artifact replay', blurb: 'Load a saved run and explore it statically.' },
];

export function LabBar({
  backend,
  mode,
  onModeChange,
  python,
  hasChampion,
  onExportChampion,
}: {
  backend: BackendStatus;
  mode: LabSource;
  onModeChange: (m: LabSource) => void;
  python: PythonLab;
  hasChampion: boolean;
  onExportChampion: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const guard = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="lab-card mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Mode selector */}
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m) => {
            const active = mode === m.id;
            const disabled = m.id === 'live' && !backend.online;
            return (
              <button
                key={m.id}
                onClick={() => onModeChange(m.id)}
                title={disabled ? 'Start the Python backend to enable live mode' : m.blurb}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  active
                    ? 'border-neon-cyan/60 bg-neon-cyan/10 text-neon-cyan'
                    : 'border-lab-border bg-lab-bg/40 text-lab-muted hover:text-lab-text'
                } ${disabled ? 'opacity-40' : ''}`}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Connection + actions */}
        <div className="flex flex-wrap items-center gap-2">
          <ConnChip backend={backend} />
          {mode === 'artifact' && (
            <>
              <button
                className="lab-btn"
                disabled={!backend.online || busy !== null}
                onClick={() => guard('latest', python.actions.loadLatest)}
              >
                {busy === 'latest' ? 'Loading…' : '⬇ Load latest'}
              </button>
              <button className="lab-btn" onClick={() => fileRef.current?.click()}>
                📁 Load run from file
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) guard('file', () => python.actions.loadRunFromFile(f));
                }}
              />
            </>
          )}
          <button className="lab-btn" disabled={!hasChampion} onClick={onExportChampion}>
            ⤓ Export champion
          </button>
        </div>
      </div>

      {mode === 'artifact' && python.runs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="lab-heading">Saved runs</span>
          <select
            className="lab-input w-auto"
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) guard('run', () => python.actions.loadRunById(id));
            }}
          >
            <option value="" disabled>
              choose a run…
            </option>
            {python.runs.map((r) => (
              <option key={r.runId} value={r.runId}>
                {r.runId} · fitness {Math.round(r.bestFitness)}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-neon-red/50 bg-neon-red/10 p-2 text-xs text-neon-red">
          ⚠ {error}
        </div>
      )}

      {mode === 'live' && !backend.online && !backend.checking && (
        <OfflineBanner backend={backend} onUseLocal={() => onModeChange('local')} />
      )}
    </section>
  );
}

function ConnChip({ backend }: { backend: BackendStatus }) {
  const { online, checking } = backend;
  const cls = online
    ? 'text-neon-green'
    : checking
      ? 'text-neon-amber animate-pulse-glow'
      : 'text-neon-red';
  const text = online ? 'backend online' : checking ? 'checking…' : 'backend offline';
  return (
    <button
      onClick={backend.recheck}
      className={`lab-chip ${cls}`}
      title={`${backend.apiBase} — click to re-check`}
    >
      ● {text}
    </button>
  );
}

function OfflineBanner({
  backend,
  onUseLocal,
}: {
  backend: BackendStatus;
  onUseLocal: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-neon-amber/50 bg-neon-amber/10 p-3 text-sm">
      <div className="font-semibold text-neon-amber">🐍 Python backend offline</div>
      <p className="mt-1 text-xs text-lab-muted">
        Live training needs the FastAPI trainer running at{' '}
        <span className="font-mono text-lab-text">{backend.apiBase}</span>. Start it with:
      </p>
      <pre className="mt-2 overflow-x-auto rounded bg-lab-bg/60 p-2 font-mono text-[11px] text-neon-cyan">
        cd trainer &amp;&amp; python -m uvicorn wordle_evolution.server.main:app --reload --port 8000
        {'\n'}# or, from the repo root:  pnpm dev:trainer
      </pre>
      <div className="mt-2 flex gap-2">
        <button className="lab-btn" onClick={backend.recheck}>
          ↻ Retry
        </button>
        <button className="lab-btn lab-btn-primary" onClick={onUseLocal}>
          🧪 Use local demo instead
        </button>
      </div>
    </div>
  );
}
