import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  EntityDirectoryEntrySchema,
  ForecastRunSchema,
  SurveillanceResponseSchema,
  seesSurveillance,
} from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import { ApiError } from '../../plugins/errors.ts';
import type { ModuleDeps } from '../ports.ts';
import { auditRead, parseRows } from '../shared.ts';

const Count = z.number().int().min(0);
const Rate = z.number().min(0);

/** One row of `orbit_erp.surveillance_feed()`, as db/surveillance.ts aliases it. */
const FeedRowSchema = z.strictObject({
  conditionId: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  windowDays: z.number().int().min(1),
  minPatients: z.number().int().min(1),
  minHospitals: z.number().int().min(1),
  patients: Count,
  hospitals: Count,
  usualPatients: Rate,
  alert: z.boolean(),
  expectedPatients: Rate.nullable(),
  pPatients: z.number().min(0).max(1).nullable(),
  pHospitals: z.number().min(0).max(1).nullable(),
});

const HospitalRowSchema = z.strictObject({
  facilityId: z.uuid(),
  conditionId: z.uuid(),
  patients: Count,
  expectedPatients: Rate.nullable(),
});

const RunRowSchema = ForecastRunSchema.omit({ beatsBaseline: true });

const LIMITATIONS = [
  'Presenting conditions are recorded on simulated visits; the history comes from the reference hospital dataset. Not a diagnosis, not a public-health notification, not for clinical decisions.',
  'The reference dataset spreads its diseases evenly, with no real outbreaks, so the forecast has little genuine pattern to learn. Read its probabilities with the accuracy shown beside them.',
  'Counts are distinct patients with a visit recording the condition. A condition not recorded on a visit is not counted.',
  'Visits recorded between the end of the reference history (17 September 2026) and the release of this page carry no condition, so recent counts, and the forecast trained on them, start low.',
];

/**
 * GET /api/surveillance (ADR 0023): the outbreak watch for SURVEILLANCE_ROLES.
 * Group totals per condition, the rule, the latest forecast, and per-hospital
 * counts for hospitals inside the caller's scope only.
 */
export function registerSurveillanceRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.get('/surveillance', async (request) => {
    const membership = membershipOf(request);
    if (!seesSurveillance(membership.role)) {
      throw new ApiError('forbidden', 'Your role does not include the outbreak watch.', 'surveillance_role_not_permitted');
    }

    const [feedRows, hospitalRows, runRow, entityRows] = await Promise.all([
      deps.surveillance.feed(membership),
      deps.surveillance.hospitals(membership),
      deps.surveillance.run(membership),
      deps.entities.visible(membership),
    ]);
    const feed = parseRows(FeedRowSchema, feedRows, 'surveillance_feed_failed_contract');
    const hospitals = parseRows(HospitalRowSchema, hospitalRows, 'surveillance_hospitals_failed_contract');
    const run = runRow === null ? null : parseRows(RunRowSchema, [runRow], 'surveillance_run_failed_contract')[0] ?? null;
    const names = new Map(
      parseRows(EntityDirectoryEntrySchema, entityRows, 'entity_row_failed_contract')
        .filter((entry) => entry.grain === 'facility')
        .map((entry) => [entry.entityId, entry.label] as const),
    );

    // Defense in depth: a hospital the caller cannot see by name is a source defect, not a row to drop.
    for (const { facilityId } of hospitals) {
      if (!names.has(facilityId)) {
        throw new ApiError('internal', 'An internal error occurred.', 'surveillance_returned_out_of_scope_hospital');
      }
    }

    const [first] = feed;
    const rule = first
      ? { windowDays: first.windowDays, minPatients: first.minPatients, minHospitals: first.minHospitals }
      : { windowDays: 7, minPatients: 50, minHospitals: 5 };

    const conditions = feed.map((row) => ({
      conditionId: row.conditionId,
      code: row.code,
      name: row.name,
      category: row.category,
      patients: row.patients,
      hospitals: row.hospitals,
      usualPatients: row.usualPatients,
      alert: row.alert,
      forecast:
        row.expectedPatients === null || row.pPatients === null || row.pHospitals === null
          ? null
          : { expectedPatients: row.expectedPatients, pPatients: row.pPatients, pHospitals: row.pHospitals },
      inScope: hospitals
        .filter((hospital) => hospital.conditionId === row.conditionId)
        .map((hospital) => ({
          facilityId: hospital.facilityId,
          name: names.get(hospital.facilityId) as string,
          patients: hospital.patients,
          expectedPatients: hospital.expectedPatients,
        }))
        .sort((a, b) => b.patients - a.patients || a.name.localeCompare(b.name)),
    }));

    const response = SurveillanceResponseSchema.parse({
      asOf: new Date().toISOString(),
      rule,
      forecastRun: run ? { ...run, beatsBaseline: run.modelMae < run.baselineMae } : null,
      conditions,
      limitations: LIMITATIONS,
      provenance: 'illustrative',
      disclosure: deps.disclosure,
    });

    await auditRead(deps, request, membership, {
      kind: 'evidence_viewed',
      target: { type: 'route', id: 'surveillance' },
      outcome: 'served',
    });
    return response;
  });
}
