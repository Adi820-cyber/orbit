import { z } from 'zod';
import type { MembershipClaims } from '@orbit/contracts';
import type { KnowledgeChunk, KnowledgeQuery, KnowledgeSource } from '../modules/ports.ts';
import type { Database } from './client.ts';
import { withMembershipTx } from './rls.ts';

/*
 * Postgres KnowledgeSource (ADR 0019). orbit.search_knowledge() is a security
 * INVOKER function, so row-level security on orbit.knowledge_chunks decides what
 * it can see: the caller's organization, a scope that covers the chunk's
 * entity, and a role or domain grant. Nothing the client sent narrows or widens
 * that. Full-text matching always runs; vector matching joins in when the
 * question could be embedded.
 *
 * The embedding is passed as a pgvector text literal ($2) because the postgres.js
 * driver has no native vector type.
 */

export const SEARCH_KNOWLEDGE_SQL = `
select
  s.id::text                                                         as "id",
  s.title                                                            as "title",
  s.content                                                          as "content",
  s.source                                                           as "source",
  s.domain                                                           as "domain",
  s.similarity                                                       as "similarity",
  s.matched_by                                                       as "matchedBy",
  to_char(s.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "updatedAt"
from orbit.search_knowledge($1, $2::extensions.vector, $3::integer, $4::float) s`;

const KnowledgeRowSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string(),
  content: z.string(),
  source: z.string(),
  domain: z.string().min(1),
  similarity: z.number(),
  matchedBy: z.enum(['vector', 'text', 'hybrid']),
  updatedAt: z.iso.datetime({ offset: true }),
});

export function createDbKnowledgeSource(db: Database): KnowledgeSource {
  return {
    async search(
      membership: MembershipClaims,
      query: KnowledgeQuery,
      options?: { threshold?: number; limit?: number },
    ): Promise<readonly KnowledgeChunk[]> {
      const vectorLiteral = query.embedding ? `[${query.embedding.join(',')}]` : null;
      return withMembershipTx(db, membership, async (tx) => {
        const rows = await tx.query(SEARCH_KNOWLEDGE_SQL, [
          query.text,
          vectorLiteral,
          options?.limit ?? 6,
          options?.threshold ?? 0.25,
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
