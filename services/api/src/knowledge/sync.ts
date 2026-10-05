import { z } from 'zod';
import type { Database } from '../db/client.ts';

/*
 * Knowledge sync (ADR 0019): keeps orbit.knowledge_chunks, the chatbot's
 * knowledge base, in step with the database, and embeds what changed.
 *
 *  1. orbit.knowledge_refresh() rebuilds every generated chunk from the data.
 *     It leaves unchanged chunks (and their embeddings) alone, so a run that
 *     finds nothing new costs no embedding calls.
 *  2. Chunks awaiting an embedding are fetched in batches, embedded, and stored
 *     only if their text still means what was embedded. The embedded text has
 *     its figures masked (orbit.knowledge_embed_text), so a count changing never
 *     costs an embedding request: a free key allows about 50 requests a day.
 *
 * Both database functions are security definer and take no input that shapes
 * what is written, so this job needs no table access and no claims. If the
 * embedding provider is unavailable the run stops cleanly: search keeps working
 * on words, and the next run picks up where this one stopped.
 */

const RefreshRowSchema = z.object({ kind: z.string(), chunks: z.number().int() });
const PendingRowSchema = z.object({ id: z.uuid(), contentHash: z.string().min(1), text: z.string().min(1) });

export interface SyncOptions {
  db: Database;
  /** Embeds texts in order, or null when the provider is unavailable. Absent: build chunks only. */
  embed?: ((texts: readonly string[]) => Promise<number[][] | null>) | undefined;
  /** Recorded with each embedding, so a later model change can be told apart. */
  model: string;
  /** Texts per embedding request. */
  batchSize?: number;
  /** Most chunks embedded in one run, so a first run over a large table is bounded. */
  maxPerRun?: number;
}

export interface SyncResult {
  built: { kind: string; chunks: number }[];
  embedded: number;
  /** False when nothing could be embedded this run: no provider, or the provider failed. */
  embeddingAvailable: boolean;
  /** True when no chunk was left waiting for an embedding. */
  complete: boolean;
}

export async function syncKnowledge(options: SyncOptions): Promise<SyncResult> {
  const { db, embed, model, batchSize = 50, maxPerRun = 600 } = options;

  const refreshed = await db.transaction((tx) => tx.query('select kind, chunks from orbit.knowledge_refresh()'));
  const built = refreshed.map((row) => RefreshRowSchema.parse(row));

  let embedded = 0;
  let embeddingAvailable = Boolean(embed);
  let complete = false;
  while (embed && embedded < maxPerRun) {
    // Sequential on purpose: each batch changes what is pending.
    // eslint-disable-next-line no-await-in-loop
    const pending = (
      await db.transaction((tx) =>
        tx.query(
          'select id::text as "id", embed_hash as "contentHash", text_to_embed as "text" from orbit.knowledge_pending($1::integer)',
          [batchSize],
        ),
      )
    ).map((row) => PendingRowSchema.parse(row));
    if (pending.length === 0) {
      complete = true;
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    const vectors = await embed(pending.map((chunk) => chunk.text));
    if (!vectors || vectors.length !== pending.length) {
      embeddingAvailable = embedded > 0;
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    await db.transaction(async (tx) => {
      for (const [index, chunk] of pending.entries()) {
        // eslint-disable-next-line no-await-in-loop
        await tx.query('select orbit.knowledge_set_embedding($1::uuid, $2, $3::extensions.vector, $4)', [
          chunk.id,
          chunk.contentHash,
          `[${(vectors[index] ?? []).join(',')}]`,
          model,
        ]);
      }
    });
    embedded += pending.length;
  }

  return { built, embedded, embeddingAvailable, complete };
}
