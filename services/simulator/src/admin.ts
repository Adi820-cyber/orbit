import { addDays, localParts } from './clock.ts';
import { read, write, type Ctx, type FacilityRef } from './ctx.ts';
import { approves, decisionDelayMinutes, REJECTION_NOTES, renewalLagDays } from './plan.ts';
import { rngFor } from './rng.ts';
import type { SimState } from './state.ts';

/**
 * The admin's desk work, done the way a person would do it: not instantly.
 *
 * Corrections wait their turn (5–45 minutes, a different delay for each) and
 * most are approved. Four-eyes still holds because the API enforces it: the
 * admin never decides a request the admin made.
 */
export async function decideCorrections(ctx: Ctx, hospitals: readonly FacilityRef[]): Promise<void> {
  // One request for every hospital: an admin may list pending corrections across the whole group.
  const list = await read(ctx, 'read pending corrections', () => ctx.admin.corrections({ state: 'submitted', page: 1, pageSize: 100 }));
  const ours = new Set(hospitals.map((hospital) => hospital.facilityId));
  const nowMs = ctx.clock.now().getTime();
  for (const correction of list?.items ?? []) {
    if (!ours.has(correction.facilityId)) continue;
    if (correction.requestedByMe) continue; // another admin would have to decide it
    const waitedMs = nowMs - Date.parse(correction.createdAt);
    if (waitedMs < decisionDelayMinutes(ctx.cfg.seed, correction.correctionId) * 60_000) continue;

    const approve = approves(ctx.cfg.seed, correction.correctionId);
    const note = approve ? undefined : rngFor(ctx.cfg.seed, 'note', correction.correctionId).pick(REJECTION_NOTES);
    const result = await write(ctx, 'decide correction', () =>
      ctx.admin.decideCorrection(correction.correctionId, {
        version: correction.version,
        decision: approve ? 'approved' : 'rejected',
        ...(note ? { note } : {}),
      }),
    );
    if (result.status === 'ok') ctx.stats.decisions += 1;
  }
}

/**
 * Once a day, mid-morning, renews doctors' credentials that are expiring or
 * have lapsed, each a little earlier or later than the next (a week before to a
 * day after, by person), and never a suspended one: a suspension is a decision
 * for a person, not a routine renewal.
 */
export async function renewCredentials(ctx: Ctx, state: SimState, today: string): Promise<void> {
  if (ctx.cfg.paused || state.credentialsDay === today || localParts(ctx.clock.now(), ctx.timeZone).hour < 10) return;
  for (const credentialStatus of ['expiring', 'expired'] as const) {
    const list = await read(ctx, 'read credentials', () => ctx.admin.doctors({ credentialStatus, page: 1, pageSize: 100 }));
    for (const doctor of list?.items ?? []) {
      if (doctor.credentialSuspended || doctor.employmentStatus !== 'active') continue;
      const renewOn = addDays(doctor.credentialExpiresOn, renewalLagDays(ctx.cfg.seed, doctor.staffId) - 7);
      if (today < renewOn) continue;
      await write(ctx, 'renew credential', () =>
        ctx.admin.updateDoctor(doctor.staffId, { version: doctor.version, credentialExpiresOn: addDays(today, 730), credentialSuspended: false }),
      );
    }
  }
  state.credentialsDay = today;
}
