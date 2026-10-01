import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { HealthResponseSchema, MeResponseSchema, OperatorMeResponseSchema } from '@orbit/contracts';
import { claimsOf, decorateMembership, isOperatorClaims, requireAuth, type AuthOptions } from './plugins/auth.ts';
import { registerErrorHandling } from './plugins/errors.ts';
import { registerModules, type ModuleDeps } from './modules/index.ts';

export interface AppOptions {
  auth: AuthOptions;
  /** Exact browser origins allowed by CORS; anything else receives no CORS grant. */
  allowedOrigins: readonly string[];
  /** Data sources for the six modules; `pendingModuleDeps()` until the schema exists. */
  modules: ModuleDeps;
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
    methods: ['GET', 'POST', 'PATCH', 'PUT'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
  });

  /*
   * The only unauthenticated routes, and the same handler on both paths.
   *
   * `/api/health` exists because of how the deployment routes traffic. Under the
   * same-origin topology in ADR 0013, a rewrite sends `/api/(.*)` to this
   * service and a catch-all sends everything else to the SPA — and Vercel
   * forwards the ORIGINAL path without stripping the matched prefix. A probe of
   * `/health` would therefore be answered by the SPA, which returns 200 with
   * `index.html` for unknown paths. A health check would report the API up while
   * it was entirely down.
   *
   * So the deployed check must target `/api/health`. `/health` is kept because
   * it costs nothing, is the conventional path, and works when the API is
   * addressed directly (locally, or from a platform probe that bypasses the
   * rewrite). Registered at the top level rather than inside the `/api` plugin
   * below, because that plugin applies `requireAuth` and a health check must
   * not need a token.
   */
  const health = async (): Promise<unknown> => HealthResponseSchema.parse({ status: 'ok' });
  app.get('/health', health);
  app.get('/api/health', health);

  await app.register(
    async (api) => {
      requireAuth(api, options.auth);

      api.get('/me', async (request) => {
        const claims = claimsOf(request);
        if (isOperatorClaims(claims)) {
          return OperatorMeResponseSchema.parse({
            operatorRole: claims.operatorRole,
            organizationId: claims.organizationId,
            scopes: claims.scopes,
          });
        }
        return MeResponseSchema.parse({
          role: claims.role,
          organizationId: claims.organizationId,
          scopes: claims.scopes,
        });
      });

      registerModules(api, options.modules);
    },
    { prefix: '/api' },
  );

  return app;
}
