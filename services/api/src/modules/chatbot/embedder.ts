import { z } from 'zod';
import type { ModelProvider } from '../ask/narrator.ts';

/*
 * Embedding generation for the knowledge base (ADR 0019).
 *
 * One POST to an OpenAI-compatible /embeddings endpoint. Only OpenRouter is
 * used: Groq exposes no embeddings endpoint, so a Groq provider is never asked
 * (it used to be, with a chat model's name, which could not work). The stored
 * vectors are 1024-dimensional (orbit.knowledge_chunks.embedding), so a model
 * that returns any other length is refused rather than truncated or padded.
 *
 * Returns null instead of throwing when the provider is unavailable, so the
 * chatbot degrades to text search and the sync job simply stops and tries again
 * on its next run.
 */

/** The column is vector(1024). A model of another size needs a migration, not a config change. */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Default model: free on OpenRouter, 1024 dimensions, chosen after testing the
 * free models on Orbit's own questions (ADR 0019 §5). Override with
 * `EMBEDDING_MODEL` (it must also return 1024 numbers).
 */
export const DEFAULT_EMBEDDING_MODEL = 'liquid/lfm-2.5-embedding-350m:free';

const EmbeddingResponseSchema = z.object({
  data: z.array(z.object({ index: z.number().int().min(0), embedding: z.array(z.number()) })).min(1),
});

export interface EmbedderOptions {
  provider: ModelProvider;
  /** Embedding model name. Defaults to {@link DEFAULT_EMBEDDING_MODEL}. */
  model?: string;
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. */
  timeoutMs?: number;
}

/** The provider that can embed, if one is configured. */
export function embeddingProvider(providers: readonly ModelProvider[]): ModelProvider | undefined {
  return providers.find((provider) => provider.name === 'openrouter');
}

/**
 * Embeddings for several texts in one request, in the order given. Null when
 * the provider fails, answers with the wrong shape, or returns a vector of the
 * wrong length for any input.
 */
export async function generateEmbeddings(
  texts: readonly string[],
  options: EmbedderOptions,
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const { provider, fetchImpl = fetch, timeoutMs = 15_000 } = options;
  // The embeddings endpoint is next to chat completions.
  const endpoint = provider.endpoint.replace('/chat/completions', '/embeddings');
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts, encoding_format: 'float' }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const parsed = EmbeddingResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.data.length !== texts.length) return null;

    const ordered = [...parsed.data.data].sort((a, b) => a.index - b.index);
    if (ordered.some((item, position) => item.index !== position || item.embedding.length !== EMBEDDING_DIMENSIONS)) {
      return null;
    }
    return ordered.map((item) => item.embedding);
  } catch {
    // Network failure, timeout or parse error: degrade, never crash.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One text. Null when unavailable; the caller falls back to text search. */
export async function generateEmbedding(text: string, options: EmbedderOptions): Promise<number[] | null> {
  const result = await generateEmbeddings([text], options);
  return result?.[0] ?? null;
}
