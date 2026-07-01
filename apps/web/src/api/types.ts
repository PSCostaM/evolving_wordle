// TypeScript mirror of the Python trainer's JSON contract.
//
// The Python side emits camelCase field names AND camelCase feature-weight keys
// at every boundary (REST responses, WebSocket event payloads, artifact files),
// so these line up structurally with the frontend's existing engine/GA types.

import { EvolutionConfig, FeatureWeights } from '../engine/types';
import { ChampionInfo, GenerationReport, PopulationMember } from '../ga/evolution';
import { BaselineSummary, ReplayMatch } from '../workers/protocol';

export type { ChampionInfo, GenerationReport, PopulationMember, BaselineSummary, ReplayMatch };

export interface HealthResponse {
  status: string;
  version: string;
}

export interface DefaultsResponse {
  config: Partial<EvolutionConfig>;
  fitness: Record<string, number>;
}

/** One row of generation_history.json (mirrors the camelCase GenerationReport summary). */
export interface GenerationHistoryRow {
  generation: number;
  evaluations: number;
  bestFitness: number;
  avgFitness: number;
  medianFitness: number;
  winRate: number;
  avgGuesses: number;
  diversityScore: number;
  championId: string;
  championNickname: string;
  elapsedMs: number;
}

export interface ExperimentSummary {
  runId: string;
  seed: string;
  config: Record<string, unknown>;
  generations: number;
  timestamp: string;
  durationMs: number;
  finalChampionId: string;
  bestFitness: number;
}

/** The combined payload returned by /api/artifacts/latest and /runs/{id}. */
export interface ArtifactBundle {
  champion: ChampionInfo;
  generationHistory: GenerationHistoryRow[];
  replaySamples: ReplayMatch[];
  baselineComparison: BaselineSummary[];
  experimentSummary: ExperimentSummary;
}

export interface RunListItem {
  runId: string;
  timestamp: string;
  generations: number;
  seed: string;
  bestFitness: number;
}

export interface WordsValidateResponse {
  valid: string[];
  invalid: string[];
}

export interface WordsImportResponse {
  answers: string[];
  guesses: string[];
  added: number;
}

// ---------------------------------------------------------------------------
// WebSocket protocol (ws://.../ws/train)
// ---------------------------------------------------------------------------

/** main -> server */
export type TrainClientCommand =
  | { type: 'start'; config: EvolutionConfig }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'reset' };

/** server -> main. Top-level summary fields are snake_case per the contract;
 *  the nested `report`, `champion`, and `sample_replay` use the camelCase shapes. */
export type TrainServerEvent =
  | { type: 'training_started' }
  | { type: 'training_paused' }
  | { type: 'training_resumed' }
  | { type: 'training_complete'; reason?: string }
  | { type: 'error'; message: string }
  | { type: 'generation_progress'; generation: number; evaluated: number; total: number }
  | {
      type: 'generation_complete';
      generation: number;
      best_fitness: number;
      average_fitness: number;
      best_win_rate: number;
      best_average_guesses: number;
      diversity: number;
      champion: { id: string; weights: FeatureWeights };
      report: GenerationReport;
      sample_replay?: ReplayMatch;
    };
