import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  EntityDirectoryEntrySchema,
  RevenueFeedQuerySchema,
  RevenueFeedResponseSchema,
  RevenueFigureSchema,
  seesRevenue,
  type RevenueFigure,
} from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import { ApiError } from '../../plugins/errors.ts';
import type { ModuleDeps } from '../ports.ts';
import { auditRead, parseInput, parseRows } from '../shared.ts';

/** One row of `orbit_erp.revenue_feed()`, as db/revenue.ts aliases it. */
const SummaryRowSchema = RevenueFigureSchema.extend({ facilityId: z.uuid() });
const DailyRowSchema = z.strictObject({
  facilityId: z.uuid(),
  day: z.iso.date(),
  gross: z.number().min(0),
  collected: z.number().min(0),
});

const ZERO: RevenueFigure = {
  bills: 0, gross: 0, insurance: 0, patient: 0, collected: 0, grossToday: 0, collectedToday: 0,
  openBills: 0, outstandingPatient: 0, outstandingInsurer: 0,
};

const round2 = (value: number) => Math.round(value * 100) / 100;

function add(total: RevenueFigure, figure: RevenueFigure): RevenueFigure {
  const sum = { ...total };
  for (const key of Object.keys(ZERO) as (keyof RevenueFigure)[]) sum[key] = round2(total[key] + figure[key]);
  return sum;
}

/**
 * GET /api/revenue (ADR 0022 §5): what the ERP billed and collected, per
 * hospital inside the caller's verified scope, for finance and operations
 * leaders (REVENUE_FEED_ROLES). Amounts only.
 */
export function registerRevenueRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.get('/revenue', async (request) => {
    const membership = membershipOf(request);
    if (!seesRevenue(membership.role)) {
      throw new ApiError('forbidden', 'Your role does not include hospital revenue.', 'revenue_role_not_permitted');
    }
    const { days } = parseInput(RevenueFeedQuerySchema, request.query);

    const [summaryRows, dailyRows, entityRows, currency] = await Promise.all([
      deps.revenue.summary(membership, days),
      deps.revenue.daily(membership, days),
      deps.entities.visible(membership),
      deps.revenue.currency(membership),
    ]);
    const summaries = parseRows(SummaryRowSchema, summaryRows, 'revenue_summary_failed_contract');
    const daily = parseRows(DailyRowSchema, dailyRows, 'revenue_daily_failed_contract');
    const names = new Map(
      parseRows(EntityDirectoryEntrySchema, entityRows, 'entity_row_failed_contract')
        .filter((entry) => entry.grain === 'facility')
        .map((entry) => [entry.entityId, entry.label] as const),
    );

    // Defense in depth: a hospital the caller cannot see by name is a source defect, not a row to drop.
    for (const { facilityId } of [...summaries, ...daily]) {
      if (!names.has(facilityId)) {
        throw new ApiError('internal', 'An internal error occurred.', 'revenue_returned_out_of_scope_hospital');
      }
    }

    const hospitals = summaries
      .map(({ facilityId, ...figures }) => ({
        facilityId,
        name: names.get(facilityId) as string,
        figures,
        daily: daily.filter((row) => row.facilityId === facilityId).map(({ facilityId: _facility, ...row }) => row),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const response = RevenueFeedResponseSchema.parse({
      days,
      currency,
      asOf: new Date().toISOString(),
      totals: hospitals.reduce((total, hospital) => add(total, hospital.figures), ZERO),
      hospitals,
      provenance: 'illustrative',
      disclosure: deps.disclosure,
    });

    await auditRead(deps, request, membership, {
      kind: 'evidence_viewed',
      target: { type: 'route', id: 'revenue' },
      outcome: 'served',
    });
    return response;
  });
}
