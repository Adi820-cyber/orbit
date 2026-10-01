import { z } from 'zod';
import type { ModelProvider } from '../ask/narrator.ts';

/*
 * Embedding generation for the RAG chatbot.
 *
 * Uses the same ModelProvider interface as the Ask narrator: the embedding
 * request is a single POST to an OpenAI-compatible /embeddings endpoint.
 * Both Groq and OpenRouter expose this, so no new dependency is needed.
 *
 * The embedder is separate from the narrator because the task is different
 * (vector encoding vs. prose rewriting) and the model may differ.
 */

const EmbeddingResponseSchema = z.object({
  data: z.tuple([z.object({ embedding: z.array(z.number()) })]).rest(z.unknown()),
});

export interface EmbedderOptions {
  /** The provider to use for embedding. Uses the chat endpoint's base URL. */
  provider: ModelProvider;
  /** Embedding model name. Defaults to provider.model but can be overridden. */
  embeddingModel?: string;
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. */
  timeoutMs?: number;
}

/**
 * Generates an embedding vector for a text string.
 *
 * Returns null rather than throwing when the provider is unavailable, so the
 * chatbot can degrade to "unavailable" rather than failing the request.
 */
export async function generateEmbedding(
  text: string,
  options: EmbedderOptions,
): Promise<number[] | null> {
  const { provider, fetchImpl = fetch, timeoutMs = 5000 } = options;
  // The embeddings endpoint is at the same base as chat completions.
  const endpoint = provider.endpoint.replace('/chat/completions', '/embeddings');
  const model = options.embeddingModel ?? provider.model;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        encoding_format: 'float',
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = await response.json();
    const parsed = EmbeddingResponseSchema.safeParse(payload);
    if (!parsed.success) return null;

    return parsed.data.data[0].embedding;
  } catch {
    // Network failure, timeout, or parse error — degrade, never crash.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
