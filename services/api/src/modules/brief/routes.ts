import type { FastifyInstance } from 'fastify';
import {
  BriefResponseSchema,
  DataLimitationSchema,
  ExceptionSchema,
  OnTrackItemSchema,
} from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import type { ModuleDeps } from '../ports.ts';
import { assertRowsInScope, loadDataset, parseRows } from '../shared.ts';

/**
 * Morning brief (PRD FR-02): Act now, Monitor, On track, Data limitations, in
 * that order, for the dataset's current period. Items keep the source's order
 * within each section; the API does not invent a severity ranking.
 */
export function registerBriefRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.get('/brief', async (request) => {
    const membership = membershipOf(request);
    const dataset = await loadDataset(deps, membership);
    const rows = await deps.exceptions.brief(membership, dataset.currentPeriod);

    const exceptions = parseRows(ExceptionSchema, rows.exceptions, 'exception_row_failed_contract');
    const onTrack = parseRows(OnTrackItemSchema, rows.onTrack, 'on_track_row_failed_contract');
    const dataLimitations = parseRows(DataLimitationSchema, rows.dataLimitations, 'limitation_row_failed_contract');

    await assertRowsInScope(membership, [...exceptions, ...onTrack], deps);

    return BriefResponseSchema.parse({
      period: dataset.currentPeriod,
      asOf: dataset.asOf,
      actNow: exceptions.filter((item) => item.priority === 'act_now'),
      monitor: exceptions.filter((item) => item.priority === 'monitor'),
      onTrack,
      dataLimitations,
      disclosure: deps.disclosure,
    });
  });
}
