/**
 * Deterministic random number generation.
 *
 * PRD §8.4 requires that regeneration with the same configuration produces
 * identical output. `Math.random()` cannot satisfy that — the ECMAScript spec
 * provides no way to seed it — which is why ADR 0003 adopted `pure-rand`.
 *
 * ── Two things about pure-rand 8.4.2 worth knowing ────────────────────────
 *
 * 1. **There is no root export.** `import ... from "pure-rand"` fails: the
 *    package only publishes subpaths such as `pure-rand/generator/...`. Hence
 *    the import paths below.
 *
 * 2. **The distribution API mutates.** `uniformInt(rng, from, to)` returns a
 *    plain number and advances `rng` in place. It is *not* the pure
 *    `[value, nextRng]` tuple form that older pure-rand versions used, and the
 *    argument order is `(rng, from, to)` — rng first.
 *
 * Both were established by reading the shipped source and probing the API, not
 * assumed. Recorded here because getting either wrong produces a confusing
 * `rng.next is not a function` rather than a clear signature error.
 *
 * ── Why a wrapper ─────────────────────────────────────────────────────────
 *
 * The mutating interface is easy to misuse: two call sites sharing a generator
 * are order-dependent, so adding a draw in one place silently shifts every
 * later value. `streamFor()` gives each logical stream its own generator
 * derived from the seed and a label, so adding a new fact family cannot perturb
 * the values of an existing one. Without that, every change to the generator
 * would churn the entire snapshot and make diffs unreviewable.
 */

import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import { uniformInt } from "pure-rand/distribution/uniformInt";

/** A seeded, mutable random source. Draws advance it in place. */
export interface Rng {
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** Float in [0, 1). */
  unit(): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  /**
   * Multiplier centred on 1, e.g. `jitter(0.05)` → [0.95, 1.05).
   * The workhorse for "same shape, slightly different" without writing
   * magic numbers at each call site.
   */
  jitter(spread: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

/** Resolution used to turn integer draws into floats. */
const UNIT_RESOLUTION = 1_000_000;

function wrap(generator: ReturnType<typeof xoroshiro128plus>): Rng {
  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new Error(`Rng.int requires integers, got (${min}, ${max}).`);
    }
    if (max < min) throw new Error(`Rng.int requires max >= min, got (${min}, ${max}).`);
    return uniformInt(generator, min, max);
  };

  const unit = (): number => int(0, UNIT_RESOLUTION - 1) / UNIT_RESOLUTION;

  const float = (min: number, max: number): number => {
    if (max < min) throw new Error(`Rng.float requires max >= min, got (${min}, ${max}).`);
    return min + unit() * (max - min);
  };

  return {
    int,
    unit,
    float,
    jitter: (spread: number): number => {
      if (spread < 0) throw new Error(`Rng.jitter requires spread >= 0, got ${spread}.`);
      return 1 + float(-spread, spread);
    },
    chance: (p: number): boolean => unit() < p,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error("Rng.pick requires a non-empty array.");
      return items[int(0, items.length - 1)]!;
    },
  };
}

/**
 * Derives a stable 32-bit integer from a label, so a named stream always gets
 * the same seed offset regardless of when it is created.
 *
 * FNV-1a: small, well-distributed for short strings, and deterministic across
 * runs and platforms — which a hash like `Object.hashCode` or anything
 * iteration-order dependent would not be.
 */
function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    // 16777619, via shifts to stay in 32-bit integer arithmetic.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

/**
 * An independent stream for one logical concern.
 *
 * Use one stream per (fact family, entity, period) rather than a single shared
 * generator. Two properties follow, and both matter for reviewability:
 *
 *   - **Order independence.** Adding a draw to one stream cannot shift the
 *     values of another, so a new fact family produces a diff confined to
 *     itself instead of rewriting every number in the snapshot.
 *   - **Reproducibility at any granularity.** One facility-month can be
 *     regenerated in isolation and will match the full run exactly, which makes
 *     a single surprising figure debuggable without regenerating everything.
 */
export function streamFor(seed: number, ...labelParts: readonly string[]): Rng {
  const label = labelParts.join("/");
  // XOR rather than add, so a label hash cannot cancel out against the seed.
  const streamSeed = (seed ^ hashLabel(label)) >>> 0;
  return wrap(xoroshiro128plus(streamSeed));
}

/** A generator seeded directly. Prefer `streamFor` unless a raw seed is needed. */
export function rngFromSeed(seed: number): Rng {
  return wrap(xoroshiro128plus(seed >>> 0));
}
