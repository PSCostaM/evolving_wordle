// Engine context construction + game playing + chromosome evaluation.
//
// buildEngineContext() does the one-time heavy lifting: index maps, static
// per-word tables, the lazy pattern matrix, the opener pool + turn-1 feature
// table (which also warms every matrix row), and the exploration probe set.
// After that, playing a game is a tight loop of matrix reads.

import { PatternMatrix } from './patternMatrix';
import { decodePattern } from './wordle';
import {
  FeatureContext,
  StaticWordTables,
  TurnState,
  buildAnswerDuplicateFlags,
  buildStaticTables,
  computeAggregates,
  computeFeatureRow,
  makeAggregates,
  normalizePool,
} from './features';
import { emptyConstraints } from './candidateFilter';
import {
  PlayerScratch,
  chooseGuess,
  effectiveWeights,
  firstGuessIndex,
  makeScratch,
  selectGuessIndex,
} from './player';
import {
  Chromosome,
  ChromosomeStats,
  DetailedMatch,
  DetailedTurn,
  FEATURE_COUNT,
  GameResult,
  PerfCaps,
  PlayedTurn,
  WIN_PATTERN,
  WORD_LENGTH,
  capsFor,
  weightsToArray,
} from './types';

const ENTROPY_COL = 1; // entropyScore column in a feature row

export interface EngineContextOptions {
  fastMode: boolean;
  useEntropy: boolean;
  maxTurns: number;
}

export interface EngineContext {
  answers: readonly string[];
  guesses: readonly string[];
  answerCount: number;
  guessCount: number;

  answerCodes: Uint8Array; // A*5
  answerDupFlags: Uint8Array; // A
  answerToGuess: Int32Array; // A -> guess index
  guessToAnswer: Int32Array; // G -> answer index or -1

  tables: StaticWordTables;
  matrix: PatternMatrix;
  featureContext: FeatureContext;

  openerPool: Int32Array; // guess indices considered for the first guess
  turn1Raw: Float32Array; // openerPool.length * 12 (raw)
  turn1Norm: Float32Array; // openerPool.length * 12 (normalized)
  probeIndices: Int32Array; // guess indices used as exploration probes

  caps: PerfCaps;
  useEntropy: boolean;
  maxTurns: number;

  /** shared scratch used by chooseGuess() on the main thread */
  explainScratch: PlayerScratch;
  /** double buffers for candidate filtering */
  candA: Int32Array;
  candB: Int32Array;
}

export interface BuildProgress {
  phase: string;
  done: number;
  total: number;
}

export function buildEngineContext(
  answers: readonly string[],
  guesses: readonly string[],
  options: EngineContextOptions,
  onProgress?: (p: BuildProgress) => void,
): EngineContext {
  const A = answers.length;
  const G = guesses.length;
  const caps = capsFor(options.fastMode);

  // -- index maps ----------------------------------------------------------
  const guessIndexByWord = new Map<string, number>();
  for (let i = 0; i < G; i++) guessIndexByWord.set(guesses[i], i);
  const answerIndexByWord = new Map<string, number>();
  for (let i = 0; i < A; i++) answerIndexByWord.set(answers[i], i);

  const answerToGuess = new Int32Array(A);
  for (let a = 0; a < A; a++) {
    const gi = guessIndexByWord.get(answers[a]);
    if (gi === undefined) throw new Error(`answer "${answers[a]}" is not in the guess list`);
    answerToGuess[a] = gi;
  }
  const guessToAnswer = new Int32Array(G).fill(-1);
  for (let g = 0; g < G; g++) {
    const ai = answerIndexByWord.get(guesses[g]);
    if (ai !== undefined) guessToAnswer[g] = ai;
  }

  // -- codes + static tables ----------------------------------------------
  const answerCodes = new Uint8Array(A * WORD_LENGTH);
  for (let a = 0; a < A; a++) {
    for (let p = 0; p < WORD_LENGTH; p++) answerCodes[a * WORD_LENGTH + p] = answers[a].charCodeAt(p) - 97;
  }
  const answerDupFlags = buildAnswerDuplicateFlags(answers);
  const tables = buildStaticTables(guesses);

  // -- opener pool: all answers + curated 5-distinct-letter openers --------
  onProgress?.({ phase: 'Selecting openers', done: 0, total: 1 });
  const openerPool = buildOpenerPool(answers, tables, answerToGuess, answerCodes, caps.openerCap);

  // -- pattern matrix (rows = opener pool) ---------------------------------
  const matrix = new PatternMatrix(openerPool, G, tables.guessCodes, answerCodes, A);
  const featureContext: FeatureContext = { tables, guessToAnswer, matrix };

  // -- precompute turn-1 feature table (also warms every matrix row) -------
  const allAnswers = new Int32Array(A);
  for (let a = 0; a < A; a++) allAnswers[a] = a;

  const agg = makeAggregates();
  computeAggregates(allAnswers, A, answerCodes, answerDupFlags, agg);

  const turn1Raw = new Float32Array(openerPool.length * FEATURE_COUNT);
  const turn1State: TurnState = {
    turn: 0,
    maxTurns: options.maxTurns,
    constraints: emptyConstraints(),
    inCandidate: new Uint8Array(A).fill(1), // every answer is a candidate at turn 1
    entropySample: allAnswers, // full answer set for an accurate opener entropy
    sampleCount: A,
    useEntropy: true, // always compute; play-time toggle only zeroes the weight
  };
  const hist = new Int32Array(243);
  for (let r = 0; r < openerPool.length; r++) {
    computeFeatureRow(turn1Raw, r * FEATURE_COUNT, openerPool[r], featureContext, agg, turn1State, hist);
    if (onProgress && (r & 63) === 0) {
      onProgress({ phase: 'Warming pattern matrix', done: r, total: openerPool.length });
    }
  }
  onProgress?.({ phase: 'Warming pattern matrix', done: openerPool.length, total: openerPool.length });

  const turn1Norm = new Float32Array(openerPool.length * FEATURE_COUNT);
  normalizePool(turn1Raw, openerPool.length, turn1Norm);

  // -- probe set: top openers by turn-1 entropy ----------------------------
  const probeIndices = selectProbes(openerPool, turn1Raw, caps.probeSetSize);

  const explainScratch = makeScratch(caps.poolCap, A, G);

  return {
    answers,
    guesses,
    answerCount: A,
    guessCount: G,
    answerCodes,
    answerDupFlags,
    answerToGuess,
    guessToAnswer,
    tables,
    matrix,
    featureContext,
    openerPool,
    turn1Raw,
    turn1Norm,
    probeIndices,
    caps,
    useEntropy: options.useEntropy,
    maxTurns: options.maxTurns,
    explainScratch,
    candA: new Int32Array(A),
    candB: new Int32Array(A),
  };
}

/** All answers + the strongest 5-distinct-letter non-answer openers, capped. */
function buildOpenerPool(
  answers: readonly string[],
  tables: StaticWordTables,
  answerToGuess: Int32Array,
  answerCodes: Uint8Array,
  cap: number,
): Int32Array {
  const A = answers.length;
  const included = new Set<number>();
  const pool: number[] = [];
  for (let a = 0; a < A; a++) {
    const gi = answerToGuess[a];
    included.add(gi);
    pool.push(gi);
  }

  // letter frequency over the answer list (how many answers contain each letter)
  const freq = new Float64Array(26);
  for (let a = 0; a < A; a++) {
    let mask = 0;
    for (let p = 0; p < WORD_LENGTH; p++) mask |= 1 << answerCodes[a * WORD_LENGTH + p];
    for (let c = 0; c < 26; c++) if (mask & (1 << c)) freq[c]++;
  }

  const extraSlots = cap - pool.length;
  if (extraSlots > 0) {
    const candidates: Array<{ gi: number; score: number }> = [];
    const codes = tables.guessCodes;
    for (let gi = 0; gi < tables.distinctCount.length; gi++) {
      if (tables.distinctCount[gi] !== WORD_LENGTH) continue; // 5 distinct letters
      if (included.has(gi)) continue;
      let score = 0;
      const off = gi * WORD_LENGTH;
      for (let p = 0; p < WORD_LENGTH; p++) score += freq[codes[off + p]];
      candidates.push({ gi, score });
    }
    candidates.sort((x, y) => y.score - x.score || x.gi - y.gi);
    for (let i = 0; i < Math.min(extraSlots, candidates.length); i++) pool.push(candidates[i].gi);
  }

  return Int32Array.from(pool);
}

/** Pick the top-N opener-pool guesses by turn-1 entropy (deterministic). */
function selectProbes(openerPool: Int32Array, turn1Raw: Float32Array, n: number): Int32Array {
  const ranked: Array<{ gi: number; entropy: number }> = [];
  for (let r = 0; r < openerPool.length; r++) {
    ranked.push({ gi: openerPool[r], entropy: turn1Raw[r * FEATURE_COUNT + ENTROPY_COL] });
  }
  ranked.sort((a, b) => b.entropy - a.entropy || a.gi - b.gi);
  return Int32Array.from(ranked.slice(0, Math.min(n, ranked.length)).map((e) => e.gi));
}

// ---------------------------------------------------------------------------
// Game playing.
// ---------------------------------------------------------------------------

/** Play one game with pre-resolved effective weights. */
export function playGame(
  ctx: EngineContext,
  weights: Float64Array,
  scratch: PlayerScratch,
  answerIndex: number,
  firstGuess: number,
): GameResult {
  const A = ctx.answerCount;
  let cur = ctx.candA;
  let next = ctx.candB;
  for (let a = 0; a < A; a++) cur[a] = a;
  let count = A;

  const turns: PlayedTurn[] = [];
  let solved = false;
  let guessCount = ctx.maxTurns;
  let remainingAfterGuess2 = 1;

  for (let turn = 0; turn < ctx.maxTurns; turn++) {
    const gi = turn === 0 ? firstGuess : selectGuessIndex(ctx, weights, scratch, cur, count, turns, turn);
    const pattern = ctx.matrix.pattern(gi, answerIndex);
    const candidatesBefore = count;

    if (pattern === WIN_PATTERN) {
      solved = true;
      guessCount = turn + 1;
      turns.push({
        guess: ctx.guesses[gi],
        guessIndex: gi,
        pattern,
        feedback: decodePattern(pattern),
        candidatesBefore,
        candidatesAfter: 1,
      });
      break;
    }

    const newCount = ctx.matrix.filter(gi, pattern, cur, count, next);
    const tmp = cur;
    cur = next;
    next = tmp;
    count = newCount;

    turns.push({
      guess: ctx.guesses[gi],
      guessIndex: gi,
      pattern,
      feedback: decodePattern(pattern),
      candidatesBefore,
      candidatesAfter: newCount,
    });

    if (turn === 1) remainingAfterGuess2 = newCount;
  }

  return {
    answer: ctx.answers[answerIndex],
    solved,
    guessCount,
    turns,
    remainingAfterGuess2,
  };
}

/** Evaluate a chromosome over a sample of answers -> aggregate stats. */
export function evaluateChromosomeStats(
  ctx: EngineContext,
  chromosome: Chromosome,
  scratch: PlayerScratch,
  answerIndices: Int32Array,
  count: number,
): ChromosomeStats {
  const weights = effectiveWeights(weightsToArray(chromosome.weights), ctx.useEntropy);
  const firstGuess = firstGuessIndex(ctx, weights);

  const histogram = [0, 0, 0, 0, 0, 0, 0];
  let wins = 0;
  let solvedIn3 = 0;
  let sumGuesses = 0;
  let sumRemaining = 0;

  for (let i = 0; i < count; i++) {
    const res = playGame(ctx, weights, scratch, answerIndices[i], firstGuess);
    if (res.solved) {
      wins++;
      histogram[res.guessCount]++;
      sumGuesses += res.guessCount;
      if (res.guessCount <= 3) solvedIn3++;
    } else {
      histogram[0]++;
      sumGuesses += ctx.maxTurns;
    }
    sumRemaining += res.remainingAfterGuess2;
  }

  const games = count;
  return {
    games,
    wins,
    winRate: wins / games,
    failureRate: (games - wins) / games,
    avgGuesses: sumGuesses / games,
    solvedIn3OrLessRate: solvedIn3 / games,
    avgRemainingAfterGuess2: sumRemaining / games,
    histogram,
  };
}

/** Play a fully-explained match (for the replay / explainability UI). */
export function playDetailedMatch(
  ctx: EngineContext,
  chromosome: Chromosome,
  answerIndex: number,
): DetailedMatch {
  const A = ctx.answerCount;
  const cur = new Int32Array(A);
  for (let a = 0; a < A; a++) cur[a] = a;
  let count = A;

  const history: PlayedTurn[] = [];
  const turns: DetailedTurn[] = [];
  let solved = false;
  let guessCount = ctx.maxTurns;

  for (let turn = 0; turn < ctx.maxTurns; turn++) {
    const decision = chooseGuess({ ctx, chromosome, candidates: cur, count, history, turn });
    const gi = indexOfGuess(ctx, decision.guess);
    const pattern = ctx.matrix.pattern(gi, answerIndex);
    const candidatesBefore = count;

    if (pattern === WIN_PATTERN) {
      solved = true;
      guessCount = turn + 1;
      const played: PlayedTurn = {
        guess: decision.guess,
        guessIndex: gi,
        pattern,
        feedback: decodePattern(pattern),
        candidatesBefore,
        candidatesAfter: 1,
      };
      turns.push({ ...played, decision });
      history.push(played);
      break;
    }

    const next = new Int32Array(A);
    const newCount = ctx.matrix.filter(gi, pattern, cur, count, next);
    const played: PlayedTurn = {
      guess: decision.guess,
      guessIndex: gi,
      pattern,
      feedback: decodePattern(pattern),
      candidatesBefore,
      candidatesAfter: newCount,
    };
    turns.push({ ...played, decision });
    history.push(played);
    cur.set(next.subarray(0, newCount));
    count = newCount;
  }

  return { answer: ctx.answers[answerIndex], solved, guessCount, turns };
}

/** Play a "random remaining candidate" game and return its turns (no decisions). */
export function playRandomMatch(
  ctx: EngineContext,
  answerIndex: number,
  rng: import('./seedRandom').Rng,
): GameResult {
  const A = ctx.answerCount;
  let cur = new Int32Array(A);
  let next = new Int32Array(A);
  for (let a = 0; a < A; a++) cur[a] = a;
  let count = A;

  const turns: PlayedTurn[] = [];
  let solved = false;
  let guessCount = ctx.maxTurns;
  let remainingAfterGuess2 = 1;

  for (let turn = 0; turn < ctx.maxTurns; turn++) {
    const gi = ctx.answerToGuess[cur[rng.int(count)]];
    const pattern = ctx.matrix.pattern(gi, answerIndex);
    const candidatesBefore = count;
    if (pattern === WIN_PATTERN) {
      solved = true;
      guessCount = turn + 1;
      turns.push({
        guess: ctx.guesses[gi],
        guessIndex: gi,
        pattern,
        feedback: decodePattern(pattern),
        candidatesBefore,
        candidatesAfter: 1,
      });
      break;
    }
    const newCount = ctx.matrix.filter(gi, pattern, cur, count, next);
    const tmp = cur;
    cur = next;
    next = tmp;
    count = newCount;
    turns.push({
      guess: ctx.guesses[gi],
      guessIndex: gi,
      pattern,
      feedback: decodePattern(pattern),
      candidatesBefore,
      candidatesAfter: newCount,
    });
    if (turn === 1) remainingAfterGuess2 = newCount;
  }

  return { answer: ctx.answers[answerIndex], solved, guessCount, turns, remainingAfterGuess2 };
}

function indexOfGuess(ctx: EngineContext, word: string): number {
  // chooseGuess returns a word from the guess list; resolve to its index.
  // (Cheap: the UI replays a handful of games, not thousands.)
  const idx = (ctx.guesses as string[]).indexOf(word);
  return idx >= 0 ? idx : 0;
}
