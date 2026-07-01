// Shared message contract between the UI (main thread) and the evolution worker.
// Both sides import these types so the protocol stays honest.

import { EvolutionConfig, Feedback, GuessDecision } from '../engine/types';
import { GenerationReport } from '../ga/evolution';
import { BaselineKey } from '../ga/fitness';

export type TerminationReason = 'fixed' | 'plateau' | 'manual';

/** A single turn in a replayed match (decision present only for heuristic bots). */
export interface ReplayTurn {
  guess: string;
  feedback: Feedback;
  pattern: number;
  candidatesBefore: number;
  candidatesAfter: number;
  decision?: GuessDecision;
}

export interface ReplayMatch {
  label: string;
  botKind: 'champion' | BaselineKey;
  answer: string;
  solved: boolean;
  guessCount: number;
  turns: ReplayTurn[];
}

export interface BaselineSummary {
  key: BaselineKey | 'champion';
  name: string;
  winRate: number;
  avgGuesses: number;
  failures: number;
  games: number;
  histogram: number[]; // [fail, 1..6]
  fitness: number;
}

// ---------------------------------------------------------------------------
// main -> worker
// ---------------------------------------------------------------------------

export type WorkerCommand =
  | { type: 'init'; answers: string[]; guesses: string[]; config: EvolutionConfig }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'step' }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'setConfig'; patch: Partial<EvolutionConfig> }
  | {
      type: 'runMatch';
      requestId: number;
      answer: string;
      label: string;
      botKind: 'champion' | BaselineKey;
      // one of these identifies the bot:
      weights?: Record<string, number>;
      mutationRate?: number;
      baselineKey?: BaselineKey;
    }
  | {
      type: 'runBaselines';
      requestId: number;
      sampleSize: number;
      keys: BaselineKey[];
      championWeights?: Record<string, number>;
    };

// ---------------------------------------------------------------------------
// worker -> main
// ---------------------------------------------------------------------------

export type WorkerEvent =
  | { type: 'initProgress'; phase: string; done: number; total: number }
  | {
      type: 'ready';
      initMs: number;
      answerCount: number;
      guessCount: number;
      matrixBytes: number;
    }
  | { type: 'progress'; report: GenerationReport }
  | { type: 'done'; report: GenerationReport | null; reason: TerminationReason }
  | { type: 'match'; requestId: number; match: ReplayMatch }
  | { type: 'baselines'; requestId: number; results: BaselineSummary[] }
  | { type: 'error'; message: string };
