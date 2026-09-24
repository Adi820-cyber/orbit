import postgres, { type Sql } from 'postgres';

export type SqlParam = string | number | boolean | null;

/** A transaction handle. SQL text is fixed by the module; values are always bound parameters. */
export interface Tx {
  query(text: string, params?: SqlParam[]): Promise<readonly Record<string, unknown>[]>;
}

export interface Database {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface DatabaseOptions {
  /** Supavisor transaction-mode pooler URL, connecting as `orbit_app` (ARCH §6.3). */
  url: string;
  /** TLS is required for hosted Supabase; only a local test database may disable it. */
  ssl?: boolean;
  /** Connections kept open by one client. Tests use 1; the API uses a small pool. */
  max?: number;
}

/** Connection settings required by the transaction-mode pooler (no prepared statements). */
export function connect(options: DatabaseOptions): Sql {
  return postgres(options.url, {
    prepare: false,
    max: options.max ?? 1,
    // Close idle connections quickly, so an idle serverless instance holds none.
    idle_timeout: 5,
    connect_timeout: 10,
    ssl: options.ssl === false ? false : 'require',
    connection: { application_name: 'orbit-api' },
  });
}

/** Wraps an existing client. The caller owns the client's lifetime. */
export function databaseFromSql(sql: Sql): Database {
  return {
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      // Box the result: postgres.js types `begin` with a conditional return type.
      const box: { result?: { value: T } } = {};
      await sql.begin(async (transaction) => {
        const tx: Tx = {
          query: async (text, params = []) => [...(await transaction.unsafe(text, params))],
        };
        box.result = { value: await fn(tx) };
      });
      if (!box.result) {
        throw new Error('Transaction completed without a result');
      }
      return box.result.value;
    },
  };
}

/** Small enough for a serverless instance, large enough for one request's parallel reads. */
export const API_POOL_SIZE = 4;

/**
 * One lazily created, small connection pool for the process.
 *
 * Opening a connection per transaction cost a full TLS + pooler handshake
 * each time (measured 3.7s cold to ap-south-1), and one request runs several
 * transactions. Reuse is safe here because nothing protected lives on the
 * connection: claims are set with transaction-local `set_config(..., true)`
 * (see rls.ts) and vanish at commit or rollback, which the RLS leak tests
 * assert against the real pooler. No query results are cached (ARCH §6.3).
 * Idle connections close after a few seconds, so an idle instance holds none.
 */
export function createDatabase(options: DatabaseOptions): Database {
  let sql: Sql | undefined;
  return {
    transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      sql ??= connect({ max: API_POOL_SIZE, ...options });
      return databaseFromSql(sql).transaction(fn);
    },
  };
}
