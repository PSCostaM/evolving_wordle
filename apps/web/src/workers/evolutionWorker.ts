/// <reference lib="webworker" />
//
// The evolution worker. It owns the (warm) engine context and the GA loop, runs
// generations off the main thread, and answers match/baseline requests in the
// gaps between generations. The loop reschedules itself with setTimeout(0) so
// queued control messages (pause/stop/step/setConfig/...) are always handled
// between atomic generations.

import {
  EngineContext,
  buildEngineContext,
  evaluateChromosomeStats,
  playDetailedMatch,
  playRandomMatch,
} from '../engine/evaluate';
import { makeScratch } from '../engine/player';
import { streamFor } from '../engine/seedRandom';
import { Chromosome, EvolutionConfig, FeatureWeights } from '../engine/types';
import { Evolution } from '../ga/evolution';
import { presetChromosome } from '../ga/chromosome';
import { BASELINE_META, computeFitness, evaluateBaseline } from '../ga/fitness';
import {
  BaselineSummary,
  ReplayMatch,
  ReplayTurn,
  WorkerCommand,
  WorkerEvent,
} from './protocol';

const ctxHolder: { ctx: EngineContext | null; evo: Evolution | null } = { ctx: null, evo: null };

type RunState = 'idle' | 'running' | 'paused' | 'stepping' | 'stopped';
let runState: RunState = 'idle';

function post(event: WorkerEvent): void {
  (self as unknown as Worker).postMessage(event);
}

self.onmessage = (ev: MessageEvent<WorkerCommand>) => {
  const cmd = ev.data;
  try {
    handleCommand(cmd);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

function handleCommand(cmd: WorkerCommand): void {
  switch (cmd.type) {
    case 'init':
      handleInit(cmd.answers, cmd.guesses, cmd.config);
      break;
    case 'start':
      if (ctxHolder.evo && runState !== 'running') {
        runState = 'running';
        scheduleTick();
      }
      break;
    case 'pause':
      if (runState === 'running') runState = 'paused';
      break;
    case 'resume':
      if (runState === 'paused') {
        runState = 'running';
        scheduleTick();
      }
      break;
    case 'step':
      if (ctxHolder.evo && (runState === 'idle' || runState === 'paused' || runState === 'stopped')) {
        runState = 'stepping';
        scheduleTick();
      }
      break;
    case 'stop':
      runState = 'stopped';
      break;
    case 'reset':
      if (ctxHolder.ctx && ctxHolder.evo) {
        runState = 'idle';
        ctxHolder.evo = new Evolution(ctxHolder.ctx, ctxHolder.evo.config);
      }
      break;
    case 'setConfig':
      if (ctxHolder.evo) {
        ctxHolder.evo.config = { ...ctxHolder.evo.config, ...cmd.patch };
        if (cmd.patch.useEntropy !== undefined && ctxHolder.ctx) {
          ctxHolder.ctx.useEntropy = cmd.patch.useEntropy;
        }
      }
      break;
    case 'runMatch':
      handleRunMatch(cmd);
      break;
    case 'runBaselines':
      handleRunBaselines(cmd);
      break;
  }
}

function handleInit(answers: string[], guesses: string[], config: EvolutionConfig): void {
  runState = 'idle';
  const t0 = performance.now();
  const ctx = buildEngineContext(
    answers,
    guesses,
    { fastMode: config.fastMode, useEntropy: config.useEntropy, maxTurns: config.maxTurns },
    (p) => post({ type: 'initProgress', phase: p.phase, done: p.done, total: p.total }),
  );
  ctxHolder.ctx = ctx;
  ctxHolder.evo = new Evolution(ctx, config);
  post({
    type: 'ready',
    initMs: performance.now() - t0,
    answerCount: ctx.answerCount,
    guessCount: ctx.guessCount,
    matrixBytes: ctx.matrix.byteSize,
  });
}

function scheduleTick(): void {
  setTimeout(tick, 0);
}

function tick(): void {
  const evo = ctxHolder.evo;
  if (!evo) return;
  if (runState !== 'running' && runState !== 'stepping') return;

  const t0 = performance.now();
  const report = evo.step();
  report.elapsedMs = performance.now() - t0;
  post({ type: 'progress', report });

  const reason = evo.terminationReason();
  if (reason) {
    runState = 'stopped';
    post({ type: 'done', report, reason });
    return;
  }
  if (runState === 'stepping') {
    runState = 'paused';
    return;
  }
  scheduleTick();
}

// ---------------------------------------------------------------------------
// Match + baseline requests (answered between generations).
// ---------------------------------------------------------------------------

function chromoFromWeights(weights: Record<string, number>, mutationRate = 0): Chromosome {
  return { id: 'match', weights: weights as FeatureWeights, mutationRate, generationBorn: 0 };
}

function handleRunMatch(cmd: Extract<WorkerCommand, { type: 'runMatch' }>): void {
  const ctx = ctxHolder.ctx;
  if (!ctx) return;
  const answerIndex = ctx.answers.indexOf(cmd.answer);
  if (answerIndex < 0) {
    post({ type: 'error', message: `answer "${cmd.answer}" is not in the answer list` });
    return;
  }

  let match: ReplayMatch;
  if (cmd.baselineKey === 'random') {
    const rng = streamFor((ctxHolder.evo?.config.seed ?? 'seed') + cmd.answer, 'replay-random', 0);
    const res = playRandomMatch(ctx, answerIndex, rng);
    match = {
      label: cmd.label,
      botKind: cmd.botKind,
      answer: res.answer,
      solved: res.solved,
      guessCount: res.guessCount,
      turns: res.turns.map(
        (t): ReplayTurn => ({
          guess: t.guess,
          feedback: t.feedback,
          pattern: t.pattern,
          candidatesBefore: t.candidatesBefore,
          candidatesAfter: t.candidatesAfter,
        }),
      ),
    };
  } else {
    const chromo =
      cmd.baselineKey !== undefined
        ? presetChromosome(cmd.baselineKey)
        : chromoFromWeights(cmd.weights ?? {}, cmd.mutationRate ?? 0);
    const detailed = playDetailedMatch(ctx, chromo, answerIndex);
    match = {
      label: cmd.label,
      botKind: cmd.botKind,
      answer: detailed.answer,
      solved: detailed.solved,
      guessCount: detailed.guessCount,
      turns: detailed.turns.map(
        (t): ReplayTurn => ({
          guess: t.guess,
          feedback: t.feedback,
          pattern: t.pattern,
          candidatesBefore: t.candidatesBefore,
          candidatesAfter: t.candidatesAfter,
          decision: t.decision,
        }),
      ),
    };
  }
  post({ type: 'match', requestId: cmd.requestId, match });
}

function handleRunBaselines(cmd: Extract<WorkerCommand, { type: 'runBaselines' }>): void {
  const ctx = ctxHolder.ctx;
  const evo = ctxHolder.evo;
  if (!ctx || !evo) return;

  const A = ctx.answerCount;
  const sampleSize = Math.min(cmd.sampleSize, A);
  const rng = streamFor(evo.config.seed, 'validation', 0);
  const pool = new Int32Array(A);
  for (let i = 0; i < A; i++) pool[i] = i;
  for (let i = 0; i < sampleSize; i++) {
    const j = i + rng.int(A - i);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const sample = pool.subarray(0, sampleSize);
  const scratch = makeScratch(ctx.caps.poolCap, A, ctx.guessCount);

  const results: BaselineSummary[] = [];

  if (cmd.championWeights) {
    const stats = evaluateChromosomeStats(
      ctx,
      chromoFromWeights(cmd.championWeights),
      scratch,
      sample,
      sampleSize,
    );
    results.push({
      key: 'champion',
      name: 'Evolved champion',
      winRate: stats.winRate,
      avgGuesses: stats.avgGuesses,
      failures: stats.games - stats.wins,
      games: stats.games,
      histogram: stats.histogram,
      fitness: computeFitness(stats, evo.config.fitness),
    });
  }

  const baseRng = streamFor(evo.config.seed, 'baseline-random', 0);
  for (const key of cmd.keys) {
    const r = evaluateBaseline(ctx, key, scratch, sample, sampleSize, evo.config.fitness, baseRng);
    results.push({
      key,
      name: BASELINE_META[key],
      winRate: r.stats.winRate,
      avgGuesses: r.stats.avgGuesses,
      failures: r.stats.games - r.stats.wins,
      games: r.stats.games,
      histogram: r.stats.histogram,
      fitness: r.fitness,
    });
  }

  post({ type: 'baselines', requestId: cmd.requestId, results });
}
