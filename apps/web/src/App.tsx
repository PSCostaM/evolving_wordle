import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_CONFIG } from './engine/types';
import { useEvolution } from './hooks/useEvolution';
import { useBackend } from './hooks/useBackend';
import { usePythonLab } from './hooks/usePythonLab';
import { EvolutionState, LabSource } from './hooks/reportState';
import { Layout } from './components/Layout';
import { LabBar } from './components/LabBar';
import { ControlPanel } from './components/ControlPanel';
import { EvolutionChart } from './components/EvolutionChart';
import { ChampionPanel } from './components/ChampionPanel';
import { WeightVisualizer } from './components/WeightVisualizer';
import { PopulationTable } from './components/PopulationTable';
import { HallOfFame } from './components/HallOfFame';
import { MatchReplay } from './components/MatchReplay';
import { ExplainabilityPanel } from './components/ExplainabilityPanel';
import { BaselineComparison } from './components/BaselineComparison';
import { WordleBoard } from './components/WordleBoard';
import { Card, ProgressBar, bytesToMb, fmt, pct } from './components/primitives';

const NICKNAMES = [
  'Caveman guesser',
  'Vowel goblin',
  'Entropy enjoyer',
  'Candidate sniper',
  'Mutation gremlin',
  'The chosen bot',
];

export default function App() {
  const localLab = useEvolution();
  const backend = useBackend();
  const python = usePythonLab({
    runMatch: localLab.actions.runMatch,
    runBaselinesLocal: localLab.actions.runBaselines,
    randomAnswer: localLab.actions.randomAnswer,
    isAnswer: localLab.actions.isAnswer,
    backendOnline: backend.online,
  });

  const [mode, setMode] = useState<LabSource>('local');
  const userPicked = useRef(false);
  const autoSwitched = useRef(false);

  const chooseMode = useCallback((m: LabSource) => {
    userPicked.current = true;
    setMode(m);
  }, []);

  // Warm the local replay engine + seed the Python view's config on mount.
  useEffect(() => {
    localLab.actions.initialize(DEFAULT_CONFIG);
    python.actions.initialize(DEFAULT_CONFIG);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First time the backend appears, hop to live mode (unless the user chose one).
  useEffect(() => {
    if (backend.online && !userPicked.current && !autoSwitched.current) {
      autoSwitched.current = true;
      setMode('live');
    }
  }, [backend.online]);

  // Refresh the saved-runs list when browsing artifacts.
  useEffect(() => {
    if (mode === 'artifact' && backend.online) void python.actions.refreshRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, backend.online]);

  const active = mode === 'local' ? localLab : python;
  const state = active.state;
  const actions = active.actions;

  const champion = state.latest?.champion ?? null;
  const championWeights = champion?.chromosome.weights ?? null;
  const generationsRun = state.history.length;

  const exportChampion = useCallback(() => {
    const champ = active.state.latest?.champion;
    if (!champ) return;
    const blob = new Blob([JSON.stringify(champ, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `champion-${champ.chromosome.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [active]);

  return (
    <Layout status={<StatusBar state={state} mode={mode} />}>
      {localLab.state.status === 'initializing' && (
        <InitOverlay progress={localLab.state.initProgress} />
      )}

      <Hero />

      <LabBar
        backend={backend}
        mode={mode}
        onModeChange={chooseMode}
        python={python}
        hasChampion={Boolean(champion)}
        onExportChampion={exportChampion}
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* Left rail */}
        <div className="space-y-5 lg:col-span-1">
          <ControlPanel state={state} actions={actions} />
          <ChampionPanel champion={champion} generation={state.latest?.generation ?? null} config={state.config} />
          <HallOfFame hallOfFame={state.hallOfFame} onReplay={(c) => actions.replayChampion(c)} />
        </div>

        {/* Main column */}
        <div className="space-y-5 lg:col-span-2">
          <EvolutionChart history={state.history} />

          <div className="grid gap-5 md:grid-cols-2">
            <LiveChampionBoard state={state} onNewWord={() => actions.runChampionMatch()} />
            <WeightVisualizer weights={championWeights} weightHistory={state.weightHistory} />
          </div>

          <ExplainabilityPanel match={state.championMatch} />

          <PopulationTable population={state.latest?.population ?? []} />

          <MatchReplay
            runMatch={actions.runMatch}
            championWeights={championWeights}
            randomAnswer={actions.randomAnswer}
            isAnswer={actions.isAnswer}
          />

          <BaselineComparison
            runBaselines={actions.runBaselines}
            championWeights={championWeights}
            sampleSize={state.config.validationSampleSize}
          />
        </div>
      </div>

      {state.error && (
        <div className="mt-5 rounded-lg border border-neon-red/50 bg-neon-red/10 p-3 text-sm text-neon-red">
          ⚠ {state.error}
        </div>
      )}

      <div className="mt-6 text-center text-xs text-lab-muted">
        {generationsRun > 0 && `Ran ${generationsRun} generations · `}
        {state.info &&
          `${fmt(state.info.answerCount)} answers · ${fmt(state.info.guessCount)} valid guesses`}
        {mode === 'local' && localLab.state.info
          ? ` · ${bytesToMb(localLab.state.info.matrixBytes)} pattern cache · warmed in ${fmt(
              localLab.state.info.initMs,
            )}ms`
          : ''}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section className="lab-card overflow-hidden p-6 sm:p-8">
      <div className="relative">
        <div className="inline-flex items-center gap-2 rounded-full border border-neon-cyan/30 bg-neon-cyan/5 px-3 py-1 text-xs text-neon-cyan">
          <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-neon-cyan" />
          python-trained genetic algorithm · zero neural networks · live-streamed to your browser
        </div>
        <h1 className="mt-3 bg-gradient-to-r from-neon-cyan via-neon-green to-neon-lime bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-5xl">
          Wordle Evolution Lab
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-lab-muted sm:text-base">
          Watch a tiny population of dumb Wordle bots evolve into terrifyingly good guessers. No
          neural nets — just twelve heuristic weights, a genetic algorithm, and a lot of natural
          selection.
        </p>
        <p className="mt-2 max-w-2xl text-xs text-lab-muted/80">
          A Python trainer runs the real evolution and streams every generation here over a
          WebSocket. No backend? Flip to <span className="text-neon-green">Local demo</span> and the
          whole GA runs in your browser, or load a saved run in{' '}
          <span className="text-neon-green">Artifact replay</span>.
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {NICKNAMES.map((n) => (
            <span key={n} className="lab-chip">
              {n}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatusBar({ state, mode }: { state: EvolutionState; mode: LabSource }) {
  const latest = state.latest;
  return (
    <div className="hidden items-center gap-2 sm:flex">
      <span className="lab-chip text-neon-purple">{mode}</span>
      {latest && (
        <>
          <span className="lab-chip text-neon-cyan">gen {latest.generation}</span>
          <span className="lab-chip text-neon-lime">win {pct(latest.winRate, 0)}</span>
          <span className="lab-chip text-neon-amber">avg {fmt(latest.avgGuesses, 2)}</span>
          <span className="lab-chip">Δdiv {latest.diversityScore.toFixed(2)}</span>
          {latest.elapsedMs > 0 && (
            <span className="lab-chip text-lab-muted">{fmt(latest.elapsedMs)}ms/gen</span>
          )}
        </>
      )}
    </div>
  );
}

function LiveChampionBoard({
  state,
  onNewWord,
}: {
  state: EvolutionState;
  onNewWord: () => void;
}) {
  const match = state.championMatch;
  return (
    <Card
      title="Champion, live"
      subtitle="The best bot playing a random word right now."
      right={
        <button className="lab-btn" onClick={onNewWord} disabled={!state.latest}>
          🎲 New word
        </button>
      }
    >
      {!match ? (
        <div className="flex h-64 items-center justify-center text-sm text-lab-muted">
          The champion takes the stage after the first generation.
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="text-center">
            <span className="text-sm font-semibold text-neon-cyan">{match.label}</span>
            <span
              className={`ml-2 text-xs ${match.solved ? 'text-neon-green' : 'text-neon-red'}`}
            >
              {match.solved ? `solved in ${match.guessCount}` : 'failed (6/6)'}
            </span>
          </div>
          <WordleBoard
            key={`${match.answer}-${match.turns.length}-${state.history.length}`}
            turns={match.turns}
            animate
          />
          <div className="text-xs text-lab-muted">
            answer was <span className="font-mono uppercase text-lab-text">{match.answer}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function InitOverlay({
  progress,
}: {
  progress: { phase: string; done: number; total: number } | null;
}) {
  const ratio = progress && progress.total > 0 ? progress.done / progress.total : 0.1;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-lab-bg/80 backdrop-blur">
      <div className="lab-card w-80 p-6 text-center">
        <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-lab-border border-t-neon-cyan" />
        <div className="text-sm font-semibold">Warming up the replay engine…</div>
        <div className="mt-1 text-xs text-lab-muted">{progress?.phase ?? 'Building pattern cache'}</div>
        <ProgressBar value={ratio} className="mt-3" />
        <div className="mt-2 text-[11px] text-lab-muted">
          Precomputing feedback patterns for ~13k words. One-time, a couple of seconds.
        </div>
      </div>
    </div>
  );
}
