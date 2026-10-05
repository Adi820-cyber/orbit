import { z } from 'zod';
import { MembershipClaimsSchema, OperatorClaimsSchema, type MembershipClaims, type OperatorClaims } from '@orbit/contracts';
import type { Database, Tx } from './client.ts';

/** Postgres setting read by RLS policies: `current_setting('orbit.membership', true)::jsonb` (ARCH §8.3). */
export const MEMBERSHIP_SETTING = 'orbit.membership';

/**
 * Postgres setting holding the verified token subject during membership
 * bootstrap only. The `org_memberships` select policy is expected to read it as
 * `subject = nullif(current_setting('orbit.subject', true), '')::uuid`: the
 * `nullif` matters because a custom setting reads as '' (not NULL) on a
 * connection where it was set before, and ''::uuid raises instead of matching
 * nothing. (Option A, pending Aditya's ADR.)
 */
export const SUBJECT_SETTING = 'orbit.subject';

const SubjectSchema = z.uuid();

/*
 * `set_config(..., true)` is the transaction-local equivalent of `SET LOCAL`
 * and, unlike `SET LOCAL`, accepts a bound parameter. The setting is discarded
 * at commit/rollback, so it cannot leak to the next client of a pooled
 * connection. Session-level `SET` is never used.
 */
const SET_LOCAL = 'select set_config($1, $2, true)';

/** Runs `fn` in a transaction whose RLS claims are the verified membership. */
export async function withMembershipTx<T>(
  db: Database,
  membership: MembershipClaims,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify(MembershipClaimsSchema.parse(membership));
  return db.transaction(async (tx) => {
    await tx.query(SET_LOCAL, [MEMBERSHIP_SETTING, claims]);
    return fn(tx);
  });
}

/**
 * Runs `fn` in a transaction whose RLS claims are a verified ERP operator
 * (ADR 0016). Same setting as `withMembershipTx`; the claims carry
 * `operatorRole` and no workbook `role`, so `orbit_erp` policies match and
 * every leader policy matches nothing.
 */
export async function withOperatorTx<T>(
  db: Database,
  operator: OperatorClaims,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify(OperatorClaimsSchema.parse(operator));
  return db.transaction(async (tx) => {
    await tx.query(SET_LOCAL, [MEMBERSHIP_SETTING, claims]);
    return fn(tx);
  });
}

/**
 * Runs `fn` in a transaction that carries only the verified token subject, so
 * the membership loader can read the caller's own `org_memberships` rows before
 * any membership claims exist. It never sets `orbit.membership`: policies keyed
 * on membership claims see nothing here.
 *
 * `subject` must come from a verified token (`verifyAccessToken`), never from
 * request data.
 */
export async function withSubjectTx<T>(
  db: Database,
  subject: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const verified = SubjectSchema.parse(subject);
  return db.transaction(async (tx) => {
    await tx.query(SET_LOCAL, [SUBJECT_SETTING, verified]);
    return fn(tx);
  });
}
