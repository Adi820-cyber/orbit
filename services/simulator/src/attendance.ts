import type { AttendanceBoardResponse } from '@orbit/contracts';
import { addDays } from './clock.ts';
import { read, write, type Ctx, type FacilityRef } from './ctx.ts';
import { attendancePlan, CORRECTION_REASONS, type AttendancePlan } from './plan.ts';
import { rngFor, stableUuid } from './rng.ts';
import type { SimState } from './state.ts';

type BoardRow = AttendanceBoardResponse['rows'][number];

export interface Boards {
  today: BoardRow[];
  yesterday: BoardRow[];
}

/**
 * The shift's attendance plan for one person, decided once and then kept. The
 * mood at that moment shapes the odds of being absent; a later mood must not
 * change a day that has already started.
 */
function planFor(ctx: Ctx, state: SimState, facility: FacilityRef, staffId: string, date: string): AttendancePlan {
  const key = `${staffId}|${date}`;
  let plan = state.plans.get(key);
  if (!plan) {
    plan = attendancePlan(ctx.cfg.seed, staffId, date, ctx.cfg.rates, ctx.moodFor(facility).absence);
    state.plans.set(key, plan);
  }
  return plan;
}

/**
 * Records one in or out punch for a person.
 *
 * On time (within the catch-up window), the hospital desk punches them at the
 * real time: the server stamps the clock, exactly as a person pressing the
 * button would. If the simulator was down and the moment has passed, an admin
 * back-dates the punch to when it should have happened, so downtime leaves a
 * correct record rather than a gap or a late-looking day. Anything older than
 * the back-fill limit is left alone: history is never rewritten.
 */
async function punchAt(ctx: Ctx, facility: FacilityRef, staffId: string, direction: 'in' | 'out', plannedMs: number, shiftDate: string): Promise<void> {
  const lateMs = ctx.clock.now().getTime() - plannedMs;
  const idempotencyKey = stableUuid(ctx.cfg.seed, 'punch', staffId, shiftDate, direction);
  const desk = ctx.deskFor(facility);

  if (lateMs <= ctx.cfg.catchupSeconds * 1000) {
    const result = await write(ctx, `punch ${direction}`, () => desk.api.punch({ staffId, direction, idempotencyKey }));
    if (result.status === 'ok') ctx.stats.punches += 1;
  } else if (lateMs <= ctx.cfg.catchupMaxHours * 3_600_000) {
    const result = await write(ctx, `back-dated punch ${direction}`, () =>
      ctx.admin.punch({ staffId, direction, idempotencyKey, punchedAt: new Date(plannedMs).toISOString() }),
    );
    if (result.status === 'ok') ctx.stats.punches += 1;
  }
}

/** Corrections already on file for a hospital, as `staffId|shiftDate`, so a rejected one is not requested again. */
async function existingCorrections(ctx: Ctx, facility: FacilityRef): Promise<Set<string>> {
  const seen = new Set<string>();
  const list = await read(ctx, 'read corrections', () => ctx.deskFor(facility).api.corrections({ facilityId: facility.facilityId, page: 1, pageSize: 100 }));
  for (const item of list?.items ?? []) seen.add(`${item.staffId}|${item.shiftDate}`);
  return seen;
}

/**
 * Punches people in and out of the shifts they are rostered for, and tidies up
 * after the ones who forgot to punch out. Looks at yesterday as well as today,
 * because a night shift that began yesterday ends this morning.
 */
export async function runAttendance(ctx: Ctx, state: SimState, facility: FacilityRef, today: string): Promise<Boards> {
  const yesterday = addDays(today, -1);
  const desk = ctx.deskFor(facility);
  const [todayBoard, yesterdayBoard] = await Promise.all([
    read(ctx, 'read board', () => desk.api.board({ facilityId: facility.facilityId, date: today })),
    read(ctx, 'read board', () => desk.api.board({ facilityId: facility.facilityId, date: yesterday })),
  ]);
  const boards: Boards = { today: todayBoard?.rows ?? [], yesterday: yesterdayBoard?.rows ?? [] };
  const nowMs = ctx.clock.now().getTime();
  let corrections: Set<string> | null = null;

  for (const [date, rows] of [[today, boards.today], [yesterday, boards.yesterday]] as const) {
    for (const row of rows) {
      const day = row.day;
      if (!day.shiftStart || !day.shiftEnd || day.status === 'on-leave') continue;
      const plan = planFor(ctx, state, facility, row.staff.staffId, date);
      const shiftStartMs = Date.parse(day.shiftStart);
      const shiftEndMs = Date.parse(day.shiftEnd);

      if (day.punchCount === 0 && !plan.absent) {
        const plannedIn = shiftStartMs + plan.inOffsetMinutes * 60_000;
        if (nowMs >= plannedIn) await punchAt(ctx, facility, row.staff.staffId, 'in', plannedIn, date);
        continue;
      }

      if (day.firstIn !== null && day.lastOut === null) {
        if (plan.outOffsetMinutes !== null) {
          const plannedOut = shiftEndMs + plan.outOffsetMinutes * 60_000;
          if (nowMs >= plannedOut && plannedOut > Date.parse(day.firstIn)) await punchAt(ctx, facility, row.staff.staffId, 'out', plannedOut, date);
          continue;
        }
        // They were always going to forget to punch out. Someone notices the next morning.
        const noticedAt = shiftEndMs + plan.fixAfterMinutes * 60_000;
        if (date !== yesterday || nowMs < noticedAt) continue;
        const rand = rngFor(ctx.cfg.seed, 'fix', row.staff.staffId, date);
        const actualOut = shiftEndMs + rand.int(0, 20) * 60_000;
        if (desk.isDesk) {
          corrections ??= await existingCorrections(ctx, facility);
          if (corrections.has(`${row.staff.staffId}|${date}`)) continue;
          const result = await write(ctx, 'request correction', () =>
            desk.api.requestCorrection({
              staffId: row.staff.staffId,
              shiftDate: date,
              proposedOut: new Date(actualOut).toISOString(),
              reason: rand.pick(CORRECTION_REASONS),
            }),
          );
          if (result.status === 'ok') {
            ctx.stats.corrections += 1;
            corrections.add(`${row.staff.staffId}|${date}`);
          }
        } else {
          // No separate desk to ask, and an admin may not approve its own request: the admin records the missed punch directly.
          const result = await write(ctx, 'record missed punch', () =>
            ctx.admin.punch({
              staffId: row.staff.staffId,
              direction: 'out',
              idempotencyKey: stableUuid(ctx.cfg.seed, 'fixpunch', row.staff.staffId, date),
              punchedAt: new Date(actualOut).toISOString(),
            }),
          );
          if (result.status === 'ok') ctx.stats.punches += 1;
        }
      }
    }
  }
  return boards;
}
