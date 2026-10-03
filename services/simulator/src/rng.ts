import { createHash } from 'node:crypto';

/*
 * Deterministic randomness. Every decision the simulator makes about a person,
 * a day or a visit comes from a stream seeded by labels (seed, entity id, date),
 * never from Math.random(). Two consequences matter for a process that runs for
 * weeks and restarts:
 *
 *  - Restarting never changes what was planned, so a restarted simulator does
 *    not re-decide the day (a person who was going to be late stays late).
 *  - Idempotency keys are derived from the same labels, so a repeated request is
 *    recognised by the API as a replay and never recorded twice.
 */

function digest(parts: readonly string[]): Buffer {
  return createHash('sha256').update(parts.join('\u001f')).digest();
}

/** A v4-shaped uuid that is a pure function of its labels. */
export function stableUuid(...parts: string[]): string {
  const bytes = Buffer.from(digest(['uuid', ...parts]).subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** mulberry32: small, fast, and good enough for simulation choices. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rand {
  /** Float in [0, 1). */
  unit(): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Poisson-distributed count with the given mean (Knuth; fine for small means). */
  poisson(mean: number): number;
}

export function rngFor(...labels: string[]): Rand {
  const seedBytes = digest(['rng', ...labels]);
  const next = mulberry32(seedBytes.readUInt32LE(0));
  const unit = () => next();
  const int = (min: number, max: number) => {
    if (max < min) throw new Error(`int(${min}, ${max}): max < min`);
    return min + Math.floor(unit() * (max - min + 1));
  };
  return {
    unit,
    int,
    chance: (p) => unit() < p,
    pick: <T>(items: readonly T[]): T => {
      const item = items[int(0, items.length - 1)];
      if (item === undefined) throw new Error('pick() from an empty list');
      return item;
    },
    poisson: (mean) => {
      if (mean <= 0) return 0;
      // Cap the mean so exp(-mean) never underflows; real means here are < 5.
      const limit = Math.exp(-Math.min(mean, 30));
      let count = 0;
      let product = unit();
      while (product > limit && count < 200) {
        count += 1;
        product *= unit();
      }
      return count;
    },
  };
}

/** A small stable integer from labels, for choices that need no stream. */
export function hashInt(...labels: string[]): number {
  return digest(['int', ...labels]).readUInt32LE(0);
}
