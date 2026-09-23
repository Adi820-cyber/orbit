import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorEnvelopeSchema, type ErrorCode } from '@orbit/contracts';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  out_of_scope: 403,
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
  internal: 500,
};

/** A typed, client-safe error. `message` is returned to the caller verbatim. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  /** Server-side detail for logs only; never sent to the client. */
  readonly reason: string | undefined;

  constructor(code: ErrorCode, message: string, reason?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = STATUS[code];
    this.reason = reason;
  }
}

function send(reply: FastifyReply, request: FastifyRequest, status: number, code: ErrorCode, message: string) {
  const body = ErrorEnvelopeSchema.parse({ error: { code, message, requestId: request.id } });
  return reply.status(status).send(body);
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) {
      request.log.info({ code: error.code, reason: error.reason }, 'request denied or failed');
      return send(reply, request, error.statusCode, error.code, error.message);
    }

    if ('validation' in error && error.validation) {
      return send(reply, request, 400, 'invalid_request', 'The request is invalid.');
    }

    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 400 && status < 500) {
      return send(reply, request, status, 'invalid_request', 'The request is invalid.');
    }

    // Unexpected: log the error server-side, return nothing that could leak internals.
    request.log.error({ err: error }, 'unhandled error');
    return send(reply, request, 500, 'internal', 'An internal error occurred.');
  });

  app.setNotFoundHandler((request, reply) =>
    send(reply, request, 404, 'not_found', 'The requested resource does not exist.'),
  );
}
