import { describe, expect, it } from "vitest";
import { rngFromSeed, streamFor } from "../rng.ts";

/**
 * PRD §8.4 makes reproducibility a hard requirement, so these guard the
 * property the whole generator rests on rather than merely exercising the API.
 */

/** Draws a fixed-length sequence from a fresh generator. */
function draw(seed: number): number[] {
  const r = rngFromSeed(seed);
  return Array.from({ length: 50 }, () => r.int(0, 1_000_000));
}

describe("determinism", () => {
  it("produces an identical sequence for the same seed", () => {
    expect(draw(20260923)).toEqual(draw(20260923));
  });

  it("produces a different sequence for a different seed", () => {
    expect(draw(20260923)).not.toEqual(draw(20260924));
  });

  it("gives a named stream the same values regardless of creation order", () => {
    // The property that keeps snapshots reviewable: adding a fact family must
    // not shift the numbers of an existing one.
    const first = streamFor(20260923, "financial", "avenhurst", "2025-03");
    const firstValues = Array.from({ length: 10 }, () => first.int(0, 10_000));

    // Create and exhaust unrelated streams, then re-create the original.
    const unrelated = streamFor(20260923, "capacity", "brackmoor", "2025-03");
    Array.from({ length: 100 }, () => unrelated.int(0, 10_000));

    const again = streamFor(20260923, "financial", "avenhurst", "2025-03");
    expect(Array.from({ length: 10 }, () => again.int(0, 10_000))).toEqual(firstValues);
  });

  it("gives different streams different values", () => {
    const a = streamFor(20260923, "financial", "avenhurst", "2025-03");
    const b = streamFor(20260923, "financial", "brackmoor", "2025-03");
    const av = Array.from({ length: 20 }, () => a.int(0, 1_000_000));
    const bv = Array.from({ length: 20 }, () => b.int(0, 1_000_000));
    expect(av).not.toEqual(bv);
  });

  it("distinguishes streams that differ only in the last label part", () => {
    const a = streamFor(1, "x", "y", "2025-01");
    const b = streamFor(1, "x", "y", "2025-02");
    expect(a.int(0, 1e9)).not.toBe(b.int(0, 1e9));
  });

  it("does not collide when label parts are regrouped", () => {
    // "a/b" joined from ["a","b"] must not equal a literal "a/b" being passed
    // as one part in a way that silently aliases a different stream.
    const a = streamFor(1, "ab", "c");
    const b = streamFor(1, "a", "bc");
    expect(a.int(0, 1e9)).not.toBe(b.int(0, 1e9));
  });
});

describe("ranges", () => {
  it("keeps int within bounds, inclusive at both ends", () => {
    const r = rngFromSeed(7);
    for (let i = 0; i < 2000; i++) {
      const v = r.int(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThanOrEqual(5);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("can return both endpoints of a narrow range", () => {
    const r = rngFromSeed(11);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(r.int(0, 1));
    expect([...seen].toSorted((a, b) => a - b)).toEqual([0, 1]);
  });

  it("handles a single-value range", () => {
    const r = rngFromSeed(3);
    expect(r.int(42, 42)).toBe(42);
  });

  it("keeps unit in [0, 1)", () => {
    const r = rngFromSeed(13);
    for (let i = 0; i < 2000; i++) {
      const v = r.unit();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("keeps float within bounds", () => {
    const r = rngFromSeed(17);
    for (let i = 0; i < 2000; i++) {
      const v = r.float(-2.5, 7.5);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(7.5);
    }
  });

  it("centres jitter on 1 within the given spread", () => {
    const r = rngFromSeed(19);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = r.jitter(0.05);
      expect(v).toBeGreaterThanOrEqual(0.95);
      expect(v).toBeLessThan(1.05);
      sum += v;
    }
    // Mean should sit near 1; loose bound so this is not flaky.
    expect(Math.abs(sum / n - 1)).toBeLessThan(0.005);
  });

  it("treats jitter(0) as exactly 1", () => {
    const r = rngFromSeed(23);
    for (let i = 0; i < 10; i++) expect(r.jitter(0)).toBe(1);
  });
});

describe("chance and pick", () => {
  it("approximates the requested probability", () => {
    const r = rngFromSeed(29);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (r.chance(0.25)) hits++;
    expect(Math.abs(hits / n - 0.25)).toBeLessThan(0.02);
  });

  it("treats chance(0) and chance(1) as absolute", () => {
    const r = rngFromSeed(31);
    for (let i = 0; i < 100; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(1)).toBe(true);
    }
  });

  it("picks only from the given array and can reach every element", () => {
    const r = rngFromSeed(37);
    const items = ["a", "b", "c", "d"] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const v = r.pick(items);
      expect(items).toContain(v);
      seen.add(v);
    }
    expect(seen.size).toBe(items.length);
  });
});

describe("input validation", () => {
  it("rejects a reversed int range", () => {
    expect(() => rngFromSeed(1).int(10, 5)).toThrow(/max >= min/);
  });

  it("rejects non-integer int bounds", () => {
    expect(() => rngFromSeed(1).int(0.5, 5)).toThrow(/requires integers/);
  });

  it("rejects a reversed float range", () => {
    expect(() => rngFromSeed(1).float(10, 5)).toThrow(/max >= min/);
  });

  it("rejects negative jitter spread", () => {
    expect(() => rngFromSeed(1).jitter(-0.1)).toThrow(/spread >= 0/);
  });

  it("rejects picking from an empty array", () => {
    expect(() => rngFromSeed(1).pick([])).toThrow(/non-empty/);
  });
});

describe("distribution quality", () => {
  it("is roughly uniform across buckets", () => {
    const r = rngFromSeed(41);
    const buckets = Array.from({ length: 10 }, () => 0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[r.int(0, 9)]!++;
    const expected = n / buckets.length;
    for (const [i, count] of buckets.entries()) {
      // Within 5% of expected — generous enough not to be flaky, tight enough
      // to catch a genuinely skewed generator.
      expect(Math.abs(count - expected) / expected, `bucket ${i}`).toBeLessThan(0.05);
    }
  });
});
