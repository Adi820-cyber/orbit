import { z } from 'zod';
import { AskModeSchema } from './ask.ts';
import { DisclosureSchema } from './common.ts';
import { ScopeEntitySchema } from './membership.ts';
import { RoleIdSchema } from './roles.ts';

/*
 * RAG chatbot payloads. The chatbot retrieves role-scoped knowledge chunks via
 * pgvector, builds a deterministic context card, and optionally narrates the
 * answer through the same model pipeline as Ask (ADR 0014).
 *
 * Authorization invariant: the retrieved chunks have already been filtered by
 * RLS (organisation + role) and by entity scope before the model sees them.
 * The model may only reword the prose; it cannot change the sources, and any
 * narration that introduces a number absent from the sources is discarded.
 */

/** `POST /api/chatbot` — a user message to the RAG chatbot. */
export const ChatbotRequestSchema = z.strictObject({
  message: z.string().trim().min(3).max(1000),
});
export type ChatbotRequest = z.infer<typeof ChatbotRequestSchema>;

/** One retrieved knowledge chunk, as used for the answer. */
export const ChatbotSourceSchema = z.strictObject({
  chunkId: z.string().min(1),
  title: z.string().min(1),
  similarity: z.number().finite(),
  /** The kind of knowledge: kpi, kpi-definitions, kpi-exceptions, hospital-operations, and so on. */
  domain: z.string().min(1),
  /** How it was found: by meaning (vector), by words (text), or both. */
  matchedBy: z.enum(['vector', 'text', 'hybrid']),
  /** When this chunk's text was last built from the data. */
  asOf: z.iso.datetime({ offset: true }),
  /** True when the answer cites it. */
  cited: z.boolean(),
});
export type ChatbotSource = z.infer<typeof ChatbotSourceSchema>;

/** The chatbot's response, with provenance and role disclosure. */
export const ChatbotResponseSchema = z.strictObject({
  answer: z.string().min(1),
  mode: AskModeSchema,
  sources: z.array(ChatbotSourceSchema),
  /**
   * `answered`: sources were found for this role and scope. `no_sources`:
   * nothing in what this role may read matches. It never says whether
   * something exists outside the role.
   */
  coverage: z.enum(['answered', 'no_sources']),
  role: RoleIdSchema,
  /** The caller's verified scope, so the answer says who it was written for. Display only. */
  scope: z.array(ScopeEntitySchema),
  provenance: z.literal('illustrative'),
  disclosure: DisclosureSchema,
});
export type ChatbotResponse = z.infer<typeof ChatbotResponseSchema>;
