import { addDays } from './clock.ts';
import { read, write, type Ctx, type FacilityRef } from './ctx.ts';
import { rosterPlan } from './plan.ts';
import type { SimState } from './state.ts';

/**
 * Keeps the next `SIM_ROSTER_DAYS_AHEAD` days rostered, so the hospital is
 * never staffed by yesterday's plan.
 *
 * A day is only filled when NOBODY at the hospital has a shift on it. That makes
 * the simulator safe to run over data that already has rosters (it never adds a
 * second shift pattern on top of someone else's), and makes a partly failed
 * fill retry from where it stopped only when the whole day is still empty.
 * One hospital-day is filled per tick, so a cold start spreads its load.
 */
export async function ensureRosters(ctx: Ctx, state: SimState, facility: FacilityRef, today: string): Promise<void> {
  if (ctx.cfg.paused) return;

  for (let offset = 0; offset < ctx.cfg.rosterDaysAhead; offset += 1) {
    const date = addDays(today, offset);
    const key = `${facility.facilityId}|${date}`;
    if (state.rostersChecked.has(key)) continue;

    const roster = await read(ctx, 'read roster', () => ctx.admin.roster({ facilityId: facility.facilityId, date }));
    if (!roster) return;
    if (roster.rows.some((row) => row.assignment !== null)) {
      state.rostersChecked.add(key);
      continue;
    }

    const shifts = roster.shiftTemplates.map((template) => ({ shiftTemplateId: template.shiftTemplateId, code: template.code }));
    let planned = 0;
    for (const row of roster.rows) {
      const shiftTemplateId = rosterPlan(ctx.cfg.seed, { staffId: row.staff.staffId, staffType: row.staff.staffType }, date, shifts);
      if (!shiftTemplateId) continue;
      const result = await write(
        ctx,
        'set roster',
        () => ctx.admin.setRoster({ staffId: row.staff.staffId, date, shiftTemplateId }),
        { counted: false },
      );
      if (result.status === 'ok') {
        planned += 1;
        ctx.stats.rosters += 1;
      }
    }
    state.rostersChecked.add(key);
    ctx.log.info('rostered a day', { hospital: facility.key, date, people: planned });
    return; // one hospital-day per tick
  }
}
