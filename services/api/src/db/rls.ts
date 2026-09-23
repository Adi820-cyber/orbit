import { MembershipClaimsSchema, type MembershipClaims } from '@orbit/contracts';
import type { Database, Tx } from './client.ts';

/** Postgres setting read by RLS policies: `current_setting('orbit.membership', true)::jsonb` (ARCH §8.3). */
export const MEMBERSHIP_SETTING = 'orbit.membership';

/**
 * Runs `fn` in a transaction whose RLS claims are the verified membership.
 *
 * `set_config(..., true)` is the transaction-local equivalent of `SET LOCAL`
 * and, unlike `SET LOCAL`, accepts a bound parameter. The setting is discarded
 * at commit/rollback, so it cannot leak to the next client of a pooled
 * connection. Session-level `SET` is never used.
 */
export async function withMembershipTx<T>(
  db: Database,
  membership: MembershipClaims,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify(MembershipClaimsSchema.parse(membership));
  return db.transaction(async (tx) => {
    await tx.query('select set_config($1, $2, true)', [MEMBERSHIP_SETTING, claims]);
    return fn(tx);
  });
}
