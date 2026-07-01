// Thin REST client for the Python trainer backend.
//
// Base URL comes from VITE_API_BASE_URL (default http://localhost:8000). Every
// call throws on a non-2xx response so callers can surface a clean error state.

import { FeatureWeights } from '../engine/types';
import { BaselineKey } from '../ga/fitness';
import {
  ArtifactBundle,
  BaselineSummary,
  DefaultsResponse,
  ExperimentSummary,
  HealthResponse,
  ReplayMatch,
  RunListItem,
  WordsImportResponse,
  WordsValidateResponse,
} from './types';

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:8000';

export const WS_BASE: string =
  (import.meta.env.VITE_WS_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  API_BASE.replace(/^http/, 'ws');

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = (body && (body.detail || body.message)) || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const api = {
  health(signal?: AbortSignal): Promise<HealthResponse> {
    return req<HealthResponse>('/health', { signal });
  },

  defaults(): Promise<DefaultsResponse> {
    return req<DefaultsResponse>('/api/config/defaults');
  },

  latestArtifacts(): Promise<ArtifactBundle> {
    return req<ArtifactBundle>('/api/artifacts/latest');
  },

  listRuns(): Promise<RunListItem[]> {
    return req<RunListItem[]>('/api/artifacts/runs');
  },

  getRun(runId: string): Promise<ArtifactBundle> {
    return req<ArtifactBundle>(`/api/artifacts/runs/${encodeURIComponent(runId)}`);
  },

  trainOffline(config: unknown): Promise<{ runId: string; summary: ExperimentSummary }> {
    return req('/api/train/offline', { method: 'POST', body: JSON.stringify(config) });
  },

  championReplay(params: {
    weights: FeatureWeights;
    answer: string;
    mutationRate?: number;
  }): Promise<ReplayMatch> {
    return req<ReplayMatch>('/api/champion/replay', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  baselinesCompare(params: {
    sampleSize: number;
    keys: BaselineKey[];
    championWeights?: FeatureWeights;
  }): Promise<BaselineSummary[]> {
    return req<BaselineSummary[]>('/api/baselines/compare', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  wordsValidate(text: string): Promise<WordsValidateResponse> {
    return req<WordsValidateResponse>('/api/words/validate', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  wordsImport(answers: string, guesses: string): Promise<WordsImportResponse> {
    return req<WordsImportResponse>('/api/words/import', {
      method: 'POST',
      body: JSON.stringify({ answers, guesses }),
    });
  },
};

export { ApiError };
