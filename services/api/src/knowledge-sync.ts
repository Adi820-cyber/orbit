import { z } from 'zod';
import { createDatabase } from './db/client.ts';
import { syncKnowledge } from './knowledge/sync.ts';
import { openRouterProvider } from './modules/ask/narrator.ts';
import { DEFAULT_EMBEDDING_MODEL, generateEmbeddings } from './modules/chatbot/embedder.ts';

/*
 * Entry point for the knowledge sync (ADR 0019): `npm run knowledge:sync`.
 * Run it on a schedule (every few minutes) on any host that can run Node and
 * reach the database: a Render cron job (render.yaml), a GitHub Actions
 * schedule, or by hand. It is not part of the API process.
 *
 * Variable names only (values never go in Git):
 *   DATABASE_URL          the pooler string as orbit_app (same as the API)
 *   OPENROUTER_API_KEY    optional. Without it chunks are built and searched by
 *                         words only; with it they are embedded for meaning too.
 *   EMBEDDING_MODEL       optional, must produce 1536 dimensions
 */
// A variable set but empty (an unset GitHub Actions secret, say) counts as not set.
const unsetIfEmpty = (value: unknown) => (value === '' ? undefined : value);
const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    OPENROUTER_API_KEY: z.preprocess(unsetIfEmpty, z.string().min(1).optional()),
    EMBEDDING_MODEL: z.preprocess(unsetIfEmpty, z.string().min(1).default(DEFAULT_EMBEDDING_MODEL)),
  })
  .safeParse(process.env);

if (!env.success) {
  console.error('knowledge sync: DATABASE_URL is required (and EMBEDDING_MODEL, if set, must be non-empty).');
  process.exit(2);
}

const { DATABASE_URL, OPENROUTER_API_KEY, EMBEDDING_MODEL } = env.data;
// Only the endpoint and key are used for embeddings; the chat model name is a placeholder.
const provider = OPENROUTER_API_KEY ? openRouterProvider(OPENROUTER_API_KEY, 'embeddings-only') : undefined;

try {
  const result = await syncKnowledge({
    db: createDatabase({ url: DATABASE_URL }),
    model: EMBEDDING_MODEL,
    embed: provider ? (texts) => generateEmbeddings(texts, { provider, model: EMBEDDING_MODEL, timeoutMs: 30_000 }) : undefined,
  });
  console.log(
    `knowledge sync: ${result.built.map((row) => `${row.kind}=${row.chunks}`).join(' ')}; embedded ${result.embedded}` +
      (provider ? '' : ' (no OPENROUTER_API_KEY: searching by words only)') +
      (provider && !result.embeddingAvailable ? ' (embedding provider unavailable; will retry next run)' : '') +
      (result.complete ? '' : '; some chunks still await embedding'),
  );
  process.exit(0);
} catch (error) {
  console.error('knowledge sync failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
