import type { ErpPageRows, ErpWrite } from '../modules/erp/ports.ts';
import type { SqlParam, Tx } from './client.ts';

/*
 * SQL helpers shared by the ERP stores (erp.ts, erp-billing.ts): formatting of
 * instants and dates, single-row and paged reads, the audit insert, and the
 * stale-or-missing check for optimistic locking.
 */

// Formatting helpers: instants as UTC ISO strings, dates as YYYY-MM-DD.
export const iso = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export const day = (column: string) => `to_char(${column}, 'YYYY-MM-DD')`;
export const hhmm = (column: string) => `to_char(${column}, 'HH24:MI')`;

/** Escapes LIKE wildcards in user text, so a search for `50%` is literal. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export function offset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

const AUDIT_SQL = `insert into orbit_erp.audit_events (action, target_type, target_id, request_id) values ($1, $2, $3::uuid, $4)`;

export type AuditAction = 'viewed' | 'created' | 'updated' | 'punched' | 'decided';

export async function audit(tx: Tx, action: AuditAction, targetType: string, targetId: string, requestId: string) {
  await tx.query(AUDIT_SQL, [action, targetType, targetId, requestId]);
}

export async function one(tx: Tx, text: string, params: SqlParam[] = []): Promise<Record<string, unknown> | null> {
  const [row] = await tx.query(text, params);
  return row ?? null;
}

export async function page(
  tx: Tx,
  countSql: string,
  pageSql: string,
  params: SqlParam[],
  paging: { page: number; pageSize: number },
): Promise<ErpPageRows> {
  const total = Number((await one(tx, countSql, params))?.['total'] ?? 0);
  const items = await tx.query(pageSql, [...params, paging.pageSize, offset(paging.page, paging.pageSize)]);
  return { items, total };
}

/** Distinguishes a stale version from a record the caller cannot see. */
export async function staleOrMissing(tx: Tx, table: string, idColumn: string, id: string): Promise<ErpWrite> {
  const row = await one(tx, `select 1 as found from ${table} where ${idColumn} = $1::uuid`, [id]);
  return row ? { status: 'stale' } : { status: 'not_found' };
}
