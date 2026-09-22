import type { MembershipSource } from '../plugins/auth.ts';
import type { Database, Tx } from './client.ts';
import { withSubjectTx } from './rls.ts';

/**
 * Reads the caller's membership rows inside a subject-only transaction.
 *
 * The SELECT itself lands once Maruti's `org_memberships` migration fixes the
 * table and column names. It must:
 * - also filter `where subject = $1` (defense in depth beside the RLS policy);
 * - return every row for the subject, active or not, so the auth plugin can
 *   tell "no membership" from "inactive" and detect ambiguity;
 * - alias columns to the `Membership` contract keys and aggregate scopes into
 *   `scopes: [{ grain, entityId }]`.
 */
export type MembershipQuery = (tx: Tx, subject: string) => Promise<readonly unknown[]>;

export function createDbMembershipSource(db: Database, query: MembershipQuery): MembershipSource {
  return {
    findBySubject: (subject) => withSubjectTx(db, subject, (tx) => query(tx, subject)),
  };
}
