import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { HealthResponseSchema, MeResponseSchema } from '@orbit/contracts';
import { decorateMembership, membershipOf, requireAuth, type AuthOptions } from './plugins/auth.ts';
import { registerErrorHandling } from './plugins/errors.ts';

export interface AppOptions {
  auth: AuthOptions;
  /** Exact browser origins allowed by CORS; anything else receives no CORS grant. */
  allowedOrigins: readonly string[];
  logger?: boolean;
}

/**
 * Builds the Fastify app without listening, so tests can use `inject`.
 * Kept out of `app.ts` because Vercel treats `src/app.ts` as the entrypoint.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie'] } : false,
  });

  registerErrorHandling(app);
  decorateMembership(app);

  await app.register(cors, {
    origin: [...options.allowedOrigins],
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
  });

  // The only unauthenticated route.
  app.get('/health', async () => HealthResponseSchema.parse({ status: 'ok' }));

  await app.register(
    async (api) => {
      requireAuth(api, options.auth);

      api.get('/me', async (request) => {
        const membership = membershipOf(request);
        return MeResponseSchema.parse({
          role: membership.role,
          organizationId: membership.organizationId,
          scopes: membership.scopes,
        });
      });
    },
    { prefix: '/api' },
  );

  return app;
}
