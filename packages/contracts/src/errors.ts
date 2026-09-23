import { z } from 'zod';

/**
 * Every API error uses this envelope. `out_of_scope` is distinct from
 * `forbidden`: the caller is a valid member but asked for data outside the
 * entitlement, and the request was refused rather than silently narrowed.
 *
 * `forbidden` covers every membership denial: no membership, no active
 * membership, and more than one active membership. The specific reason
 * (e.g. `ambiguous_membership`) is logged server-side only and is never a
 * response code, so a response does not disclose the caller's membership state.
 *
 * DRAFT: HTTP status for `out_of_scope` (currently 403) is an open decision.
 */
export const ErrorCodeSchema = z.enum([
  'unauthenticated',
  'forbidden',
  'out_of_scope',
  'invalid_request',
  'not_found',
  'conflict',
  'unavailable',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
