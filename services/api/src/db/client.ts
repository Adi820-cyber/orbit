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
}

/** Connection settings required by the transaction-mode pooler (no prepared statements). */
export function connect(options: DatabaseOptions): Sql {
  return postgres(options.url, {
    prepare: false,
    max: 1,
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

/**
 * Opens one connection per transaction and always closes it, because Vercel
 * instances are ephemeral and must not hold pooled state between requests.
 */
export function createDatabase(options: DatabaseOptions): Database {
  return {
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const sql = connect(options);
      try {
        return await databaseFromSql(sql).transaction(fn);
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
  };
}
