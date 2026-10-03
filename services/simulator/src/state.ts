import type { DoctorListResponse, ErpReferenceResponse, ServiceCatalogueResponse } from '@orbit/contracts';
import type { AttendancePlan } from './plan.ts';
import { NEUTRAL_MOOD, type Mood } from './director.ts';

/**
 * What the simulator remembers between ticks. Everything here is a cache or a
 * "already done" marker: the source of truth is always the ERP. Losing it (a
 * restart) costs a few repeated reads and replayed idempotent requests, never
 * a duplicate record or a changed decision, because decisions are derived from
 * seeded streams (rng.ts) and not stored.
 */
export interface SimState {
  /** Attendance decisions, frozen the first time they are evaluated so a changing mood cannot flip a person's day. */
  plans: Map<string, AttendancePlan>;
  /** `facilityId|date` pairs whose roster is known to be planned. */
  rostersChecked: Set<string>;
  /** `encounterId|index` services already recorded (or permanently refused). */
  delivered: Set<string>;
  doctors: Map<string, { atMs: number; items: DoctorListResponse['items'] }>;
  catalogues: Map<string, { atMs: number; items: ServiceCatalogueResponse['items'] }>;
  reference: { atMs: number; value: ErpReferenceResponse } | null;
  /** Hospitals known to have their minimum staff (bootstrap.ts). */
  staffed: Set<string>;
  /** The service catalogue has been checked (and built if it was empty). */
  catalogueChecked: boolean;
  mood: Mood;
  moodAtMs: number;
  /** Local date the credential renewals last ran for. */
  credentialsDay: string | null;
  /** Local date the caches were last pruned for. */
  prunedDay: string | null;
  ticks: number;
}

export function createState(): SimState {
  return {
    plans: new Map(),
    rostersChecked: new Set(),
    delivered: new Set(),
    doctors: new Map(),
    catalogues: new Map(),
    reference: null,
    staffed: new Set(),
    catalogueChecked: false,
    mood: NEUTRAL_MOOD,
    moodAtMs: 0,
    credentialsDay: null,
    prunedDay: null,
    ticks: 0,
  };
}
