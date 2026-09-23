/**
 * The organizational grain order, as a DAG.
 *
 * ADR 0011 §4 is explicit that this is **not a total order**:
 *
 *     group ──→ region ──→ facility
 *       └────→ coe ────→ facility
 *
 * `region` and `coe` are **incomparable**. A COE spans facilities rather than
 * sitting inside a region, so no "above"/"below" comparison between those two
 * is well-defined, and any invariant phrased as a single ordering is wrong
 * somewhere.
 *
 * Implemented as reachability rather than a numeric level, because ADR 0011
 * spells out the failure mode of the numeric version: a level number forces
 * `region` and `coe` onto the same rung and would quietly permit a `region`
 * breakdown for `coe-lead`, which is a widening the ADR forbids.
 *
 * `segment` is deliberately absent. ADR 0012 established it is a payer/insurer
 * dimension, not a position in this hierarchy, so it has no place in the graph
 * at all.
 */

/** A grain that exists in the organizational model. Excludes `segment`. */
export type OrgGrain = "group" | "region" | "facility" | "coe";

export const ORG_GRAINS: readonly OrgGrain[] = ["group", "region", "facility", "coe"];

/** Direct edges: a grain to the grains one step beneath it. */
const EDGES: Readonly<Record<OrgGrain, readonly OrgGrain[]>> = {
  group: ["region", "coe"],
  region: ["facility"],
  coe: ["facility"],
  facility: [],
};

/**
 * Every grain reachable from `from` by following one or more edges.
 *
 * Strict descendants — `from` itself is never included, which is what makes
 * "strictly below" fall out of the definition rather than needing a separate
 * equality check.
 */
export function descendantsOf(from: OrgGrain): ReadonlySet<OrgGrain> {
  const seen = new Set<OrgGrain>();
  const queue: OrgGrain[] = [...EDGES[from]];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...EDGES[next]);
  }
  return seen;
}

/** True when `candidate` sits strictly below `base` in the DAG. */
export function isStrictlyBelow(candidate: OrgGrain, base: OrgGrain): boolean {
  return descendantsOf(base).has(candidate);
}

/**
 * The highest grain in a set — the one from which every other member is
 * reachable.
 *
 * Used to resolve ADR 0011's "strictly below the row's **highest** base grain"
 * for roles with more than one base grain. Only `clinical-director` has two
 * today (`group` and `coe`), and `group` is the answer there.
 *
 * Throws when the set has no single highest member, rather than picking one.
 * Two incomparable base grains would make the breakdown invariant ambiguous in
 * exactly the way ADR 0011 §4 was corrected to avoid, so it must be a loud
 * failure and a deliberate decision — not a silent choice made here.
 */
export function highestGrain(grains: readonly OrgGrain[]): OrgGrain {
  if (grains.length === 0) throw new Error("highestGrain: empty grain set");

  const unique = [...new Set(grains)];
  if (unique.length === 1) return unique[0]!;

  const candidates = unique.filter((candidate) => {
    const below = descendantsOf(candidate);
    return unique.every((other) => other === candidate || below.has(other));
  });

  if (candidates.length !== 1) {
    throw new Error(
      `highestGrain: [${unique.join(", ")}] has no single highest grain ` +
        `(found ${candidates.length} candidates). region and coe are ` +
        `incomparable, so a role holding both needs an explicit decision in ` +
        `ADR 0011 rather than an inferred one.`,
    );
  }
  return candidates[0]!;
}
