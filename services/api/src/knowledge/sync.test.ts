import { describe, expect, it } from 'vitest';
import type { Database, SqlParam, Tx } from '../db/client.ts';
import { syncKnowledge } from './sync.ts';

type Pending = {
  id: string;
  contentHash: string;
  text: string;
};

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A database that models just the three functions the job calls. */
function fakeDb(pending: Pending[]) {
  const stored: { id: string; hash: string; model: string; vector: string }[] = [];
  const calls: string[] = [];
  const tx: Tx = {
    async query(text: string, params: SqlParam[] = []) {
      if (text.includes('knowledge_refresh_billing')) {
        calls.push('billing');
        return [{ chunks: 4 }];
      }
      calls.push(text.includes('knowledge_refresh') ? 'refresh' : text.includes('knowledge_pending') ? 'pending' : 'set');
      if (text.includes('knowledge_refresh')) {
        return [{ kind: 'kpi-definition', chunks: 2 }, { kind: 'operations', chunks: 9 }];
      }
      if (text.includes('knowledge_pending')) {
        return pending.slice(0, Number(params[0]));
      }
      const [id, hash, vector, model] = params as [string, string, string, string];
      stored.push({ id, hash, model, vector });
      const at = pending.findIndex((row) => row.id === id);
      if (at >= 0) pending.splice(at, 1);
      return [{ ok: true }];
    },
  };
  const db: Database = { transaction: async (fn) => fn(tx) };
  return { db, stored, calls };
}

const chunks = (count: number): Pending[] =>
  Array.from({ length: count }, (_, i) => ({ id: ID(i + 1), contentHash: `h${i + 1}`, text: `chunk ${i + 1}` }));

describe('syncKnowledge', () => {
  it('builds the chunks and embeds each pending one, recording the model and the hash it was made from', async () => {
    const { db, stored } = fakeDb(chunks(3));
    const result = await syncKnowledge({
      db,
      model: 'm',
      batchSize: 2,
      embed: async (texts) => texts.map((_, i) => [i, 0.5]),
    });
    expect(result.built).toEqual([{ kind: 'kpi-definition', chunks: 2 }, { kind: 'operations', chunks: 9 }, { kind: 'billing', chunks: 4 }]);
    expect(result.embedded).toBe(3);
    expect(result.complete).toBe(true);
    expect(stored.map((row) => [row.id, row.hash, row.model])).toEqual([
      [ID(1), 'h1', 'm'],
      [ID(2), 'h2', 'm'],
      [ID(3), 'h3', 'm'],
    ]);
    expect(stored[0]?.vector).toBe('[0,0.5]');
  });

  it('makes no embedding call when nothing changed', async () => {
    const { db } = fakeDb([]);
    let embedCalls = 0;
    const result = await syncKnowledge({ db, model: 'm', embed: async () => (embedCalls++, []) });
    expect(embedCalls).toBe(0);
    expect(result).toMatchObject({ embedded: 0, complete: true });
  });

  it('only builds chunks when there is no embedding provider', async () => {
    const { db, calls } = fakeDb(chunks(2));
    const result = await syncKnowledge({ db, model: 'm' });
    expect(calls).toEqual(['refresh', 'billing']);
    expect(result).toMatchObject({ embedded: 0, embeddingAvailable: false, complete: false });
  });

  it('stops cleanly when the provider fails, keeping what was already stored', async () => {
    const { db, stored } = fakeDb(chunks(4));
    let call = 0;
    const result = await syncKnowledge({
      db,
      model: 'm',
      batchSize: 2,
      embed: async (texts) => (++call === 1 ? texts.map(() => [1]) : null),
    });
    expect(stored).toHaveLength(2);
    expect(result).toMatchObject({ embedded: 2, embeddingAvailable: true, complete: false });
  });

  it('is bounded per run', async () => {
    const { db } = fakeDb(chunks(10));
    const result = await syncKnowledge({ db, model: 'm', batchSize: 2, maxPerRun: 4, embed: async (texts) => texts.map(() => [1]) });
    expect(result.embedded).toBe(4);
    expect(result.complete).toBe(false);
  });
});
