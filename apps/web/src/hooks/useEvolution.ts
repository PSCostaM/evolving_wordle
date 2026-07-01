// useEvolution: the single source of truth for the UI.
//
// Owns the Web Worker, translates button clicks into commands, folds worker
// events into React state, and exposes promise-based helpers for on-demand
// match replays and baseline comparisons.

import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultWordLists } from '../data/wordlists';
import { EvolutionConfig, FeatureWeights } from '../engine/types';
import { ChampionInfo, GenerationReport } from '../ga/evolution';
import { EvolutionState, INITIAL_STATE, foldReport } from './reportState';
import { BaselineKey } from '../ga/fitness';
import {
  BaselineSummary,
  ReplayMatch,
  WorkerCommand,
  WorkerEvent,
} from '../workers/protocol';
import EvolutionWorker from '../workers/evolutionWorker?worker';

export type {
  EvolutionStatus,
  HistoryPoint,
  WeightSnapshot,
  EngineInfo,
  EvolutionState,
} from './reportState';

const INITIAL = INITIAL_STATE;

export function useEvolution() {
  const [state, setState] = useState<EvolutionState>(INITIAL);

  const workerRef = useRef<Worker | null>(null);
  const answersRef = useRef<string[]>([]);
  const requestIdRef = useRef(1);
  const pendingRef = useRef(new Map<number, (value: unknown) => void>());
  const autoMatchInFlight = useRef(false);
  const autoMatchRef = useRef(true);
  const latestChampionRef = useRef<ChampionInfo | null>(null);

  // ---- worker setup -------------------------------------------------------
  useEffect(() => {
    const worker = new EvolutionWorker();
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<WorkerEvent>) => {
      const e = ev.data;
      switch (e.type) {
        case 'initProgress':
          setState((s) => ({
            ...s,
            status: 'initializing',
            initProgress: { phase: e.phase, done: e.done, total: e.total },
          }));
          break;
        case 'ready':
          setState((s) => ({
            ...s,
            status: 'ready',
            initProgress: null,
            info: {
              answerCount: e.answerCount,
              guessCount: e.guessCount,
              matrixBytes: e.matrixBytes,
              initMs: e.initMs,
            },
          }));
          break;
        case 'progress':
          setState((s) => foldReport(s, e.report));
          maybeAutoMatch(e.report);
          break;
        case 'done':
          setState((s) => ({
            ...s,
            status: 'done',
            doneReason: e.reason,
            latest: e.report ?? s.latest,
          }));
          break;
        case 'match': {
          const resolve = pendingRef.current.get(e.requestId);
          if (resolve) {
            pendingRef.current.delete(e.requestId);
            resolve(e.match);
          }
          break;
        }
        case 'baselines': {
          const resolve = pendingRef.current.get(e.requestId);
          if (resolve) {
            pendingRef.current.delete(e.requestId);
            resolve(e.results);
          }
          break;
        }
        case 'error':
          setState((s) => ({ ...s, status: 'error', error: e.message }));
          break;
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const command = useCallback((cmd: WorkerCommand) => {
    workerRef.current?.postMessage(cmd);
  }, []);

  // ---- lifecycle actions --------------------------------------------------
  const initialize = useCallback(
    (config: EvolutionConfig, lists?: { answers: string[]; guesses: string[] }) => {
      const wl = lists ?? defaultWordLists();
      answersRef.current = wl.answers;
      setState((s) => ({
        ...INITIAL,
        status: 'initializing',
        config,
        // keep hall of fame across re-inits within a session
        hallOfFame: s.hallOfFame,
      }));
      command({ type: 'init', answers: wl.answers, guesses: wl.guesses, config });
    },
    [command],
  );

  const start = useCallback(() => {
    setState((s) => ({ ...s, status: 'running', doneReason: null }));
    command({ type: 'start' });
  }, [command]);

  const pause = useCallback(() => {
    setState((s) => ({ ...s, status: 'paused' }));
    command({ type: 'pause' });
  }, [command]);

  const resume = useCallback(() => {
    setState((s) => ({ ...s, status: 'running' }));
    command({ type: 'resume' });
  }, [command]);

  const stepOne = useCallback(() => {
    command({ type: 'step' });
  }, [command]);

  const stop = useCallback(() => {
    setState((s) => ({ ...s, status: 'paused' }));
    command({ type: 'stop' });
  }, [command]);

  const reset = useCallback(() => {
    setState((s) => ({
      ...s,
      status: 'ready',
      latest: null,
      history: [],
      weightHistory: [],
      championMatch: null,
      doneReason: null,
    }));
    command({ type: 'reset' });
  }, [command]);

  const updateConfig = useCallback(
    (patch: Partial<EvolutionConfig>) => {
      setState((s) => ({ ...s, config: { ...s.config, ...patch } }));
      command({ type: 'setConfig', patch });
    },
    [command],
  );

  const setAutoMatch = useCallback((on: boolean) => {
    autoMatchRef.current = on;
  }, []);

  // ---- request/response helpers ------------------------------------------
  const nextRequestId = () => requestIdRef.current++;

  const runMatch = useCallback(
    (params: {
      answer: string;
      label: string;
      botKind: 'champion' | BaselineKey;
      weights?: FeatureWeights;
      mutationRate?: number;
      baselineKey?: BaselineKey;
    }): Promise<ReplayMatch> => {
      const requestId = nextRequestId();
      return new Promise<ReplayMatch>((resolve) => {
        pendingRef.current.set(requestId, resolve as (v: unknown) => void);
        command({ type: 'runMatch', requestId, ...params });
      });
    },
    [command],
  );

  const runBaselines = useCallback(
    (sampleSize: number, keys: BaselineKey[], championWeights?: FeatureWeights): Promise<BaselineSummary[]> => {
      const requestId = nextRequestId();
      return new Promise<BaselineSummary[]>((resolve) => {
        pendingRef.current.set(requestId, resolve as (v: unknown) => void);
        command({ type: 'runBaselines', requestId, sampleSize, keys, championWeights });
      });
    },
    [command],
  );

  const randomAnswer = useCallback(() => {
    const a = answersRef.current;
    return a.length ? a[Math.floor(Math.random() * a.length)] : 'crane';
  }, []);

  const isAnswer = useCallback((word: string) => answersRef.current.includes(word.toLowerCase()), []);

  const replayChampion = useCallback(
    async (champion: ChampionInfo, answer?: string) => {
      const target = answer ?? randomAnswer();
      const match = await runMatch({
        answer: target,
        label: champion.nickname,
        botKind: 'champion',
        weights: champion.chromosome.weights,
        mutationRate: champion.chromosome.mutationRate,
      });
      setState((s) => ({ ...s, championMatch: match }));
    },
    [runMatch, randomAnswer],
  );

  const runChampionMatch = useCallback(
    async (answer?: string) => {
      const champ = latestChampionRef.current;
      if (!champ) return;
      await replayChampion(champ, answer);
    },
    [replayChampion],
  );

  // Auto-run a champion match whenever a new report arrives (self-throttled so
  // only one match is in flight at a time — keeps the live board lively without
  // flooding the worker).
  const maybeAutoMatch = useCallback(
    (report: GenerationReport) => {
      latestChampionRef.current = report.champion;
      if (!autoMatchRef.current || autoMatchInFlight.current) return;
      autoMatchInFlight.current = true;
      runMatch({
        answer: randomAnswer(),
        label: report.champion.nickname,
        botKind: 'champion',
        weights: report.champion.chromosome.weights,
        mutationRate: report.champion.chromosome.mutationRate,
      })
        .then((match) => setState((s) => ({ ...s, championMatch: match })))
        .finally(() => {
          autoMatchInFlight.current = false;
        });
    },
    [runMatch, randomAnswer],
  );

  return {
    state,
    actions: {
      initialize,
      start,
      pause,
      resume,
      stepOne,
      stop,
      reset,
      updateConfig,
      runMatch,
      runBaselines,
      runChampionMatch,
      replayChampion,
      setAutoMatch,
      randomAnswer,
      isAnswer,
    },
  };
}

