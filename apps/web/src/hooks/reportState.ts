// Shared lab view-model + report-folding logic.
//
// Both the local Web-Worker source (useEvolution) and the Python-backend source
// (usePythonLab) produce this SAME EvolutionState shape and fold generation
// reports the same way, so every display component works unchanged regardless of
// where the data came from.

import { DEFAULT_CONFIG, EvolutionConfig, FeatureWeights } from '../engine/types';
import { ChampionInfo, GenerationReport } from '../ga/evolution';
import { ReplayMatch } from '../workers/protocol';

export type EvolutionStatus =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'running'
  | 'paused'
  | 'done'
  | 'error';

/** Where the currently-displayed data is coming from. */
export type LabSource = 'local' | 'live' | 'artifact';

export interface HistoryPoint {
  generation: number;
  bestFitness: number;
  avgFitness: number;
  medianFitness: number;
  winRate: number;
  avgGuesses: number;
  diversity: number;
}

export interface WeightSnapshot {
  generation: number;
  weights: FeatureWeights;
}

export interface EngineInfo {
  answerCount: number;
  guessCount: number;
  matrixBytes: number;
  initMs: number;
}

/** Live progress within the generation currently being evaluated. */
export interface GenProgress {
  generation: number;
  evaluated: number;
  total: number;
}

export interface EvolutionState {
  status: EvolutionStatus;
  initProgress: { phase: string; done: number; total: number } | null;
  info: EngineInfo | null;
  latest: GenerationReport | null;
  history: HistoryPoint[];
  weightHistory: WeightSnapshot[];
  hallOfFame: ChampionInfo[];
  championMatch: ReplayMatch | null;
  /** Live per-generation evaluation progress (null when not mid-generation). */
  genProgress: GenProgress | null;
  doneReason: string | null;
  error: string | null;
  config: EvolutionConfig;
}

export const INITIAL_STATE: EvolutionState = {
  status: 'uninitialized',
  initProgress: null,
  info: null,
  latest: null,
  history: [],
  weightHistory: [],
  hallOfFame: [],
  championMatch: null,
  genProgress: null,
  doneReason: null,
  error: null,
  config: DEFAULT_CONFIG,
};

/** Fold a generation report into the running UI state. */
export function foldReport(s: EvolutionState, report: GenerationReport): EvolutionState {
  const point: HistoryPoint = {
    generation: report.generation,
    bestFitness: report.bestFitness,
    avgFitness: report.avgFitness,
    medianFitness: report.medianFitness,
    winRate: report.winRate,
    avgGuesses: report.avgGuesses,
    diversity: report.diversityScore,
  };

  const hof = updateHallOfFame(s.hallOfFame, report.champion);

  return {
    ...s,
    status: s.status === 'paused' ? 'paused' : 'running',
    latest: report,
    history: [...s.history, point],
    weightHistory: [
      ...s.weightHistory,
      { generation: report.generation, weights: report.champion.chromosome.weights },
    ],
    hallOfFame: hof,
    genProgress: null,
  };
}

/** Keep the best champion seen so far, plus notable improvements. */
export function updateHallOfFame(current: ChampionInfo[], champion: ChampionInfo): ChampionInfo[] {
  const best = current.length ? current[0].fitness : -Infinity;
  if (champion.fitness > best + 1) {
    return [{ ...champion }, ...current].slice(0, 12);
  }
  return current;
}
