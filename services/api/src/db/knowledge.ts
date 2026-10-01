import { z } from 'zod';
import type { MembershipClaims } from '@orbit/contracts';
import type { KnowledgeChunk, KnowledgeSource } from '../modules/ports.ts';
import type { Database } from './client.ts';
import { withMembershipTx } from './rls.ts';

/*
 * SQL for knowledge chunk retrieval via pgvector. Runs under RLS as orbit_app
 * so the org + role filtering is enforced by the `knowledge_chunks_select_own_org`
 * policy. The entity-level filter is applied in the query itself.
 *
 * The embedding is passed as a text-encoded vector literal ($1) because the
 * postgres.js driver does not have a native vector type. Postgres casts the
 * text to vector via the `::vector` cast.
 */

const MATCH_SQL = `
select
  k.id::text   as "id",
  k.title      as "title",
  k.content    as "content",
  k.source     as "source",
  1 - (k.embedding <=> $1::vector) as "similarity"
from orbit.knowledge_chunks k
where
  ($2::text is null or k.entity_grain is null or k.entity_grain = $2)
  and ($3::uuid is null or k.entity_id is null or k.entity_id = $3)
  and 1 - (k.embedding <=> $1::vector) > $4
order by k.embedding <=> $1::vector
limit $5`;

const KnowledgeRowSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string(),
  content: z.string(),
  source: z.string(),
  similarity: z.number(),
});

export function createDbKnowledgeSource(db: Database): KnowledgeSource {
  return {
    async search(
      membership: MembershipClaims,
      embedding: number[],
      options?: { threshold?: number; limit?: number; entityGrain?: string; entityId?: string },
    ): Promise<readonly KnowledgeChunk[]> {
      const threshold = options?.threshold ?? 0.75;
      const limit = options?.limit ?? 5;
      const entityGrain = options?.entityGrain ?? null;
      const entityId = options?.entityId ?? null;

      // Encode the embedding as a pgvector literal: '[0.1,0.2,...,0.3]'
      const vectorLiteral = `[${embedding.join(',')}]`;

      return withMembershipTx(db, membership, async (tx) => {
        const rows = await tx.query(MATCH_SQL, [
          vectorLiteral,
          entityGrain,
          entityId,
          threshold,
          limit,
        ]);
        return rows.map((row) => {
          const parsed = KnowledgeRowSchema.safeParse(row);
          if (!parsed.success) {
            // Fail closed on a malformed row rather than leaking partial data.
            throw new Error('knowledge_chunk_row_failed_contract');
          }
          return parsed.data;
        });
      });
    },
  };
}
