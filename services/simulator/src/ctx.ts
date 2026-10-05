import type { ErpReferenceResponse } from '@orbit/contracts';
import type { Clock } from './clock.ts';
import type { SimConfig } from './config.ts';
import type { FacilityMood, Mood } from './director.ts';
import { moodFor } from './director.ts';
import { SimApiError, type ErpApi } from './erp-client.ts';
import type { Logger } from './log.ts';

/** A hospital as the simulator addresses it. `key` is the lowercase first word of its name (`avenhurst`). */
export interface FacilityRef {
  facilityId: string;
  name: string;
  key: string;
}

export function facilityKey(name: string): string {
  return (name.replace(/^kestrion\s+/i, '').split(/\s+/)[0] ?? name).toLowerCase();
}

export interface TickStats {
  writes: number;
  skippedWrites: number;
  failures: number;
  punches: number;
  corrections: number;
  decisions: number;
  rosters: number;
  patients: number;
  visits: number;
  services: number;
  closed: number;
  hires: number;
}

export function emptyStats(): TickStats {
  return { writes: 0, skippedWrites: 0, failures: 0, punches: 0, corrections: 0, decisions: 0, rosters: 0, patients: 0, visits: 0, services: 0, closed: 0, hires: 0 };
}

/** Everything one tick of the simulator works with. */
export interface Ctx {
  cfg: SimConfig;
  clock: Clock;
  log: Logger;
  admin: ErpApi;
  /** The desk for a hospital, or the admin when that hospital has none (`isDesk` says which). */
  deskFor(facility: FacilityRef): { api: ErpApi; isDesk: boolean };
  ref: ErpReferenceResponse;
  timeZone: string;
  mood: Mood;
  moodFor(facility: FacilityRef): FacilityMood;
  stats: TickStats;
  /** Writes still allowed this tick. */
  budget: { remaining: number };
}

export type WriteResult<T> =
  | { status: 'ok'; value: T }
  /** Paused or out of budget this tick: nothing was sent, try again later. */
  | { status: 'skipped' }
  | { status: 'failed'; error: unknown; /** A rule refused it; repeating the same request cannot succeed. */ permanent: boolean };

/**
 * Runs one write if the simulator is not paused and the tick still has budget.
 * A refused write is an expected event (a rule said no), so it is logged and
 * counted, never thrown: one bad record must not stop the rest of the hospital.
 * `counted: false` skips the per-tick budget (used for filling a whole roster day).
 */
export async function write<T>(ctx: Ctx, label: string, run: () => Promise<T>, options: { counted?: boolean } = {}): Promise<WriteResult<T>> {
  const counted = options.counted ?? true;
  if (ctx.cfg.paused || (counted && ctx.budget.remaining <= 0)) {
    ctx.stats.skippedWrites += 1;
    return { status: 'skipped' };
  }
  if (counted) ctx.budget.remaining -= 1;
  try {
    const value = await run();
    ctx.stats.writes += 1;
    return { status: 'ok', value };
  } catch (error: unknown) {
    ctx.stats.failures += 1;
    logFailure(ctx.log, label, error);
    return { status: 'failed', error, permanent: isPermanentRefusal(error) };
  }
}

/** Runs a read, logging and swallowing a failure. */
export async function read<T>(ctx: Ctx, label: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error: unknown) {
    ctx.stats.failures += 1;
    logFailure(ctx.log, label, error);
    return undefined;
  }
}

export function logFailure(log: Logger, label: string, error: unknown): void {
  if (error instanceof SimApiError) {
    // The API's messages are generic rule text ("That employee code is already in use."), safe to log.
    log.warn('request refused or failed', { what: label, status: error.status, code: error.code, message: error.message, requestId: error.requestId });
  } else {
    log.error('unexpected error', { what: label, message: error instanceof Error ? error.message : 'unknown' });
  }
}

/** A refusal by a business rule (4xx other than auth/rate limiting): retrying the same thing cannot help. */
export function isPermanentRefusal(error: unknown): boolean {
  return error instanceof SimApiError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429;
}

export { moodFor };
