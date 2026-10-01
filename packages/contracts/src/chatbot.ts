import { z } from 'zod';
import { AskModeSchema } from './ask.ts';
import { DisclosureSchema } from './common.ts';
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

/** One retrieved knowledge chunk cited in the response. */
export const ChatbotSourceSchema = z.strictObject({
  chunkId: z.string().min(1),
  title: z.string().min(1),
  similarity: z.number().finite(),
});
export type ChatbotSource = z.infer<typeof ChatbotSourceSchema>;

/** The chatbot's response, with provenance and role disclosure. */
export const ChatbotResponseSchema = z.strictObject({
  answer: z.string().min(1),
  mode: AskModeSchema,
  sources: z.array(ChatbotSourceSchema),
  role: RoleIdSchema,
  provenance: z.literal('illustrative'),
  disclosure: DisclosureSchema,
});
export type ChatbotResponse = z.infer<typeof ChatbotResponseSchema>;
