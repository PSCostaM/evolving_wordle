// usePythonLab: a lab view-model sourced from the Python backend.
//
// It exposes the SAME { state, actions } surface as useEvolution, so the display
// components don't care which source is active. Two data paths:
//   • Live training  — drives the /ws/train WebSocket and folds each
//     `generation_complete` event into state exactly like the local worker.
//   • Artifact replay — loads saved JSON (from the REST API or an uploaded file)
//     and renders it statically.
//
// Interactive per-answer replays (Match replay, live champion board,
// explainability) are delegated to the injected local engine, which can faithfully
// re-play any champion's weights offline — so they work even before/without a run.

import { useCallback, useEffect, useRef, useState } from 'react';
import { EvolutionConfig, FeatureWeights } from '../engine/types';
import { ChampionInfo, GenerationReport } from '../ga/evolution';
import { BaselineKey } from '../ga/fitness';
import { BaselineSummary, ReplayMatch } from '../workers/protocol';
import { api } from '../api/client';
import { TrainingSocket } from '../api/trainingSocket';
import { ArtifactBundle, RunListItem, TrainServerEvent } from '../api/types';
import {
  EvolutionState,
  HistoryPoint,
  INITIAL_STATE,
  LabSource,
  foldReport,
} from './reportState';

type RunMatchParams = {
  answer: string;
  label: string;
  botKind: 'champion' | BaselineKey;
  weights?: FeatureWeights;
  mutationRate?: number;
  baselineKey?: BaselineKey;
};

export interface PythonLabDeps {
  /** Pure replay via the local engine (does not mutate any state). */
  runMatch: (params: RunMatchParams) => Promise<ReplayMatch>;
  runBaselinesLocal: (
    sampleSize: number,
    keys: BaselineKey[],
    championWeights?: FeatureWeights,
  ) => Promise<BaselineSummary[]>;
  randomAnswer: () => string;
  isAnswer: (w: string) => boolean;
  backendOnline: boolean;
}

const DEFAULT_INFO = { answerCount: 2315, guessCount: 12972, matrixBytes: 0, initMs: 0 };

export function usePythonLab(deps: PythonLabDeps) {
  const [state, setState] = useState<EvolutionState>({ ...INITIAL_STATE });
  const [source, setSource] = useState<LabSource>('live');
  const [runs, setRuns] = useState<RunListItem[]>([]);

  const socketRef = useRef<TrainingSocket | null>(null);
  const bundleRef = useRef<ArtifactBundle | null>(null);
  const configRef = useRef<EvolutionConfig>(state.config);
  const sourceRef = useRef<LabSource>('live');
  const autoMatchOn = useRef(true);
  const autoMatchInFlight = useRef(false);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  configRef.current = state.config;
  sourceRef.current = source;

  // ---- champion replay (delegated to the local engine) --------------------
  const replayInto = useCallback((champion: ChampionInfo, answer?: string) => {
    const d = depsRef.current;
    const target = answer ?? d.randomAnswer();
    return d
      .runMatch({
        answer: target,
        label: champion.nickname,
        botKind: 'champion',
        weights: champion.chromosome.weights,
        mutationRate: champion.chromosome.mutationRate,
      })
      .then((match) => {
        setState((s) => ({ ...s, championMatch: match }));
        return match;
      });
  }, []);

  const maybeAutoMatch = useCallback((report: GenerationReport) => {
    if (!autoMatchOn.current || autoMatchInFlight.current) return;
    autoMatchInFlight.current = true;
    replayInto(report.champion).finally(() => {
      autoMatchInFlight.current = false;
    });
  }, [replayInto]);

  // ---- WebSocket event handling ------------------------------------------
  const handleEvent = useCallback(
    (ev: TrainServerEvent) => {
      switch (ev.type) {
        case 'training_started':
          setState((s) => ({ ...s, status: 'running', error: null, doneReason: null, genProgress: null }));
          break;
        case 'training_paused':
          setState((s) => ({ ...s, status: 'paused' }));
          break;
        case 'training_resumed':
          setState((s) => ({ ...s, status: 'running' }));
          break;
        case 'generation_progress':
          setState((s) => ({
            ...s,
            status: s.status === 'paused' ? 'paused' : 'running',
            genProgress: {
              generation: ev.generation,
              evaluated: ev.evaluated,
              total: ev.total,
            },
          }));
          break;
        case 'generation_complete':
          setState((s) => foldReport(s, ev.report));
          maybeAutoMatch(ev.report);
          break;
        case 'training_complete':
          setState((s) => ({ ...s, status: 'done', doneReason: ev.reason ?? 'complete', genProgress: null }));
          break;
        case 'error':
          setState((s) => ({ ...s, status: 'error', error: ev.message, genProgress: null }));
          break;
      }
    },
    [maybeAutoMatch],
  );

  const ensureSocket = useCallback((): TrainingSocket => {
    if (!socketRef.current) {
      socketRef.current = new TrainingSocket({
        onEvent: handleEvent,
        onClose: () =>
          setState((s) =>
            s.status === 'running' || s.status === 'paused'
              ? { ...s, status: 'ready', error: 'Lost connection to the training backend.' }
              : s,
          ),
      });
    }
    return socketRef.current;
  }, [handleEvent]);

  useEffect(() => {
    return () => socketRef.current?.close();
  }, []);

  // ---- lifecycle actions --------------------------------------------------
  const initialize = useCallback((config: EvolutionConfig) => {
    setSource('live');
    setState({
      ...INITIAL_STATE,
      status: 'ready',
      info: DEFAULT_INFO,
      config,
    });
  }, []);

  const start = useCallback(() => {
    setSource('live');
    setState((s) => ({
      ...s,
      status: 'running',
      history: [],
      weightHistory: [],
      latest: null,
      championMatch: null,
      genProgress: null,
      doneReason: null,
      error: null,
    }));
    ensureSocket().send({ type: 'start', config: configRef.current });
  }, [ensureSocket]);

  const pause = useCallback(() => {
    setState((s) => ({ ...s, status: 'paused' }));
    socketRef.current?.send({ type: 'pause' });
  }, []);

  const resume = useCallback(() => {
    setState((s) => ({ ...s, status: 'running' }));
    ensureSocket().send({ type: 'resume' });
  }, [ensureSocket]);

  const stop = useCallback(() => {
    setState((s) => ({ ...s, status: 'done', doneReason: 'manual' }));
    socketRef.current?.send({ type: 'stop' });
  }, []);

  const reset = useCallback(() => {
    setState((s) => ({
      ...INITIAL_STATE,
      status: 'ready',
      info: s.info ?? DEFAULT_INFO,
      config: s.config,
    }));
    socketRef.current?.send({ type: 'reset' });
  }, []);

  const stepOne = useCallback(() => {
    /* single-generation stepping is only supported in local demo mode */
  }, []);

  const updateConfig = useCallback((patch: Partial<EvolutionConfig>) => {
    setState((s) => ({ ...s, config: { ...s.config, ...patch } }));
  }, []);

  const setAutoMatch = useCallback((on: boolean) => {
    autoMatchOn.current = on;
  }, []);

  // ---- replay / baseline helpers -----------------------------------------
  const runMatch = useCallback((params: RunMatchParams) => depsRef.current.runMatch(params), []);

  const runBaselines = useCallback(
    async (
      sampleSize: number,
      keys: BaselineKey[],
      championWeights?: FeatureWeights,
    ): Promise<BaselineSummary[]> => {
      if (sourceRef.current === 'artifact' && bundleRef.current) {
        return bundleRef.current.baselineComparison;
      }
      if (depsRef.current.backendOnline) {
        try {
          return await api.baselinesCompare({ sampleSize, keys, championWeights });
        } catch {
          /* fall back to the local engine below */
        }
      }
      return depsRef.current.runBaselinesLocal(sampleSize, keys, championWeights);
    },
    [],
  );

  const runChampionMatch = useCallback(
    (answer?: string) => {
      setState((s) => {
        if (s.latest?.champion) void replayInto(s.latest.champion, answer);
        return s;
      });
    },
    [replayInto],
  );

  const replayChampion = useCallback(
    (champion: ChampionInfo, answer?: string) => {
      void replayInto(champion, answer);
    },
    [replayInto],
  );

  // ---- artifact loading ---------------------------------------------------
  const applyBundle = useCallback((bundle: ArtifactBundle) => {
    bundleRef.current = bundle;
    const rows = bundle.generationHistory ?? [];
    const history: HistoryPoint[] = rows.map((r) => ({
      generation: r.generation,
      bestFitness: r.bestFitness,
      avgFitness: r.avgFitness,
      medianFitness: r.medianFitness,
      winRate: r.winRate,
      avgGuesses: r.avgGuesses,
      diversity: r.diversityScore,
    }));
    const last = rows[rows.length - 1];
    const champion = bundle.champion;
    const latest: GenerationReport = {
      generation: last?.generation ?? champion.chromosome.generationBorn,
      evaluations: 0,
      bestFitness: last?.bestFitness ?? champion.fitness,
      avgFitness: last?.avgFitness ?? champion.fitness,
      medianFitness: last?.medianFitness ?? champion.fitness,
      winRate: champion.stats.winRate,
      avgGuesses: champion.stats.avgGuesses,
      diversityScore: last?.diversityScore ?? 0,
      champion,
      population: [],
      elapsedMs: 0,
    };
    setSource('artifact');
    setState({
      ...INITIAL_STATE,
      status: 'done',
      doneReason: `loaded ${bundle.experimentSummary?.runId ?? 'artifact'}`,
      info: DEFAULT_INFO,
      config: state.config,
      history,
      weightHistory: [{ generation: latest.generation, weights: champion.chromosome.weights }],
      hallOfFame: [champion],
      latest,
      championMatch: bundle.replaySamples?.[0] ?? null,
    });
  }, [state.config]);

  const loadLatest = useCallback(async () => {
    const bundle = await api.latestArtifacts();
    applyBundle(bundle);
  }, [applyBundle]);

  const loadRunById = useCallback(
    async (runId: string) => {
      const bundle = await api.getRun(runId);
      applyBundle(bundle);
    },
    [applyBundle],
  );

  const loadRunFromFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const bundle = JSON.parse(text) as ArtifactBundle;
      if (!bundle.champion) throw new Error('File is not a valid artifact bundle (missing champion).');
      applyBundle(bundle);
    },
    [applyBundle],
  );

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await api.listRuns());
    } catch {
      setRuns([]);
    }
  }, []);

  const exportChampion = useCallback(() => {
    const champ = state.latest?.champion;
    if (!champ) return;
    const blob = new Blob([JSON.stringify(champ, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `champion-gen${champ.chromosome.generationBorn}-${champ.chromosome.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state.latest]);

  const randomAnswer = useCallback(() => depsRef.current.randomAnswer(), []);
  const isAnswer = useCallback((w: string) => depsRef.current.isAnswer(w), []);

  return {
    state,
    source,
    runs,
    actions: {
      initialize,
      start,
      pause,
      resume,
      stepOne,
      stop,
      reset,
      updateConfig,
      setAutoMatch,
      runMatch,
      runBaselines,
      runChampionMatch,
      replayChampion,
      randomAnswer,
      isAnswer,
      // python-only
      loadLatest,
      loadRunById,
      loadRunFromFile,
      refreshRuns,
      exportChampion,
    },
  };
}

export type PythonLab = ReturnType<typeof usePythonLab>;
