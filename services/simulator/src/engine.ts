import { decideCorrections, renewCredentials } from './admin.ts';
import { runAttendance } from './attendance.ts';
import { bootstrapCatalogue, bootstrapStaff } from './bootstrap.ts';
import { runCare } from './care.ts';
import { addDays, localParts, type Clock } from './clock.ts';
import type { SimConfig } from './config.ts';
import { emptyStats, facilityKey, logFailure, type Ctx, type FacilityRef, type TickStats } from './ctx.ts';
import { moodFor, NEUTRAL_MOOD, type Director } from './director.ts';
import type { ErpApi } from './erp-client.ts';
import type { Logger } from './log.ts';
import { ensureRosters } from './rosters.ts';
import { createState, type SimState } from './state.ts';

export interface SimDeps {
  cfg: SimConfig;
  clock: Clock;
  log: Logger;
  admin: ErpApi;
  /** Desk accounts by facility key; a hospital without one is served by the admin. */
  desks: ReadonlyMap<string, ErpApi>;
  director: Director;
}

export interface TickSummary {
  tick: number;
  today: string;
  hospitals: number;
  mood: string;
  stats: TickStats;
}

const REFERENCE_TTL_MS = 10 * 60_000;

/**
 * One simulator. `tick()` looks at what the hospitals are doing right now and
 * does whatever the people in them would do next. It keeps no schedule of its
 * own: every tick re-derives "what should have happened by now" from the ERP's
 * current state and the deterministic plans, so a tick is safe to repeat, skip
 * or run after a long pause.
 */
export function createSimulator(deps: SimDeps): { state: SimState; tick(): Promise<TickSummary> } {
  const state = createState();

  async function reference(nowMs: number) {
    if (!state.reference || nowMs - state.reference.atMs > REFERENCE_TTL_MS) {
      state.reference = { atMs: nowMs, value: await deps.admin.reference() };
    }
    return state.reference.value;
  }

  async function chooseMood(nowMs: number, today: string, hospitals: readonly FacilityRef[], localMinutes: number): Promise<void> {
    if (deps.cfg.providers.length === 0) {
      state.mood = NEUTRAL_MOOD;
      return;
    }
    if (nowMs - state.moodAtMs < deps.cfg.directorMinutes * 60_000) return;
    state.moodAtMs = nowMs;
    const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    const time = `${String(Math.floor(localMinutes / 60)).padStart(2, '0')}:${String(localMinutes % 60).padStart(2, '0')}`;
    state.mood = await deps.director.decide({
      localTime: `${today} ${time}`,
      weekday,
      facilityKeys: hospitals.map((hospital) => hospital.key),
      previous: state.mood,
    });
  }

  function prune(today: string): void {
    if (state.prunedDay === today) return;
    const keepFrom = addDays(today, -1);
    for (const key of state.plans.keys()) {
      if ((key.split('|')[1] ?? '') < keepFrom) state.plans.delete(key);
    }
    for (const key of state.rostersChecked) {
      if ((key.split('|')[1] ?? '') < today) state.rostersChecked.delete(key);
    }
    state.prunedDay = today;
  }

  return {
    state,
    async tick() {
      const now = deps.clock.now();
      const nowMs = now.getTime();
      const ref = await reference(nowMs);
      const timeZone = ref.settings?.timeZone ?? 'UTC';
      const parts = localParts(now, timeZone);
      const all: FacilityRef[] = ref.facilities.map((facility) => ({ facilityId: facility.facilityId, name: facility.name, key: facilityKey(facility.name) }));
      const hospitals = deps.cfg.facilities ? all.filter((facility) => deps.cfg.facilities?.includes(facility.key)) : all;

      await chooseMood(nowMs, parts.date, hospitals, parts.minutes);
      prune(parts.date);

      const ctx: Ctx = {
        cfg: deps.cfg,
        clock: deps.clock,
        log: deps.log,
        admin: deps.admin,
        deskFor: (facility) => {
          const desk = deps.desks.get(facility.key);
          return desk ? { api: desk, isDesk: true } : { api: deps.admin, isDesk: false };
        },
        ref,
        timeZone,
        mood: state.mood,
        moodFor: (facility) => moodFor(state.mood, facility.key),
        stats: emptyStats(),
        budget: { remaining: deps.cfg.maxWritesPerTick },
      };

      if (deps.cfg.bootstrap) {
        try {
          await bootstrapCatalogue(ctx, state, hospitals);
        } catch (error: unknown) {
          ctx.stats.failures += 1;
          logFailure(deps.log, 'bootstrap catalogue', error);
        }
      }

      for (const hospital of hospitals) {
        // One hospital failing must never stop the others.
        try {
          const staffed = deps.cfg.bootstrap ? await bootstrapStaff(ctx, state, hospital, parts.date) : true;
          if (staffed) await ensureRosters(ctx, state, hospital, parts.date);
          const boards = await runAttendance(ctx, state, hospital, parts.date);
          await runCare(ctx, state, hospital, boards);
        } catch (error: unknown) {
          ctx.stats.failures += 1;
          logFailure(deps.log, `hospital ${hospital.key}`, error);
        }
      }

      try {
        await decideCorrections(ctx, hospitals);
      } catch (error: unknown) {
        ctx.stats.failures += 1;
        logFailure(deps.log, 'decide corrections', error);
      }

      try {
        await renewCredentials(ctx, state, parts.date);
      } catch (error: unknown) {
        ctx.stats.failures += 1;
        logFailure(deps.log, 'renew credentials', error);
      }

      state.ticks += 1;
      return { tick: state.ticks, today: parts.date, hospitals: hospitals.length, mood: state.mood.headline, stats: ctx.stats };
    },
  };
}
