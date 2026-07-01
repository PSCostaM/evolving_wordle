// Deterministic, seeded randomness.
//
// Everything stochastic in training/evaluation flows through this module so that
// the SAME seed string reproduces byte-identical runs. We deliberately avoid a
// single global stream: any refactor that changed call interleaving would break
// reproducibility. Instead we derive an independent sub-stream per (purpose,
// generation) from the master seed.

/** Hash a string into four 32-bit seeds (Bret Mulligan's cyrb128). */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** mulberry32 PRNG — fast, tiny, good enough for a GA. */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small integer mixer used for pure, order-independent sampling. */
export function hashInt(x: number): number {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Combine two integers into a new 32-bit hash (for salted pure sampling). */
export function hash2(a: number, b: number): number {
  return hashInt((hashInt(a) ^ Math.imul(b + 0x9e3779b9, 2654435761)) >>> 0);
}

export class Rng {
  private next01: () => number;

  constructor(seed: number) {
    this.next01 = mulberry32(seed >>> 0);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.next01();
  }

  /** Uniform 32-bit unsigned integer. */
  u32(): number {
    return Math.floor(this.next01() * 4294967296) >>> 0;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next01() * n);
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next01() * (max - min);
  }

  /**
   * Standard normal via Box–Muller. We intentionally do NOT cache the spare
   * value: forked streams have unpredictable call counts and a cached spare
   * would leak between them, breaking determinism.
   */
  gaussian(): number {
    let u = 0;
    let v = 0;
    // avoid log(0)
    while (u === 0) u = this.next01();
    while (v === 0) v = this.next01();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** In-place Fisher–Yates shuffle. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** Sample k distinct items (returns a new array; k is clamped to arr.length). */
  sample<T>(arr: readonly T[], k: number): T[] {
    const n = arr.length;
    const take = Math.min(k, n);
    // Partial Fisher–Yates over a copy of indices.
    const idx = Array.from({ length: n }, (_, i) => i);
    const out: T[] = [];
    for (let i = 0; i < take; i++) {
      const j = i + this.int(n - i);
      const tmp = idx[i];
      idx[i] = idx[j];
      idx[j] = tmp;
      out.push(arr[idx[i]]);
    }
    return out;
  }

  /** Derive an independent child stream labelled by a string. */
  fork(label: string): Rng {
    const [a] = cyrb128(label);
    return new Rng((this.u32() ^ a) >>> 0);
  }
}

/**
 * Build an Rng for a specific (purpose, generation) from the master seed
 * string. Same seed + purpose + gen => identical stream, regardless of any
 * unrelated code changes elsewhere.
 */
export function streamFor(seedString: string, purpose: string, generation: number): Rng {
  const [m0, m1, m2, m3] = cyrb128(seedString);
  const p = cyrb128(purpose)[0];
  const seed =
    (m0 ^ Math.imul(p ^ generation, 2654435761) ^ Math.imul(m1, 40503) ^ (m2 << 1) ^ (m3 >>> 1)) >>>
    0;
  return new Rng(seed);
}
