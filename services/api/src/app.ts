import { createRemoteJWKSet } from 'jose';
import { buildApp } from './build.ts';
import { loadConfig } from './config.ts';
import { pendingModuleDeps } from './modules/pending.ts';
import { ApiError } from './plugins/errors.ts';
import type { MembershipSource } from './plugins/auth.ts';

// Vercel entrypoint (src/app.ts). The app is built in ./build.ts.
const config = loadConfig();

/**
 * The membership table does not exist yet (Maruti's schema, ARCH §7.1).
 * Until it does, every protected request fails closed as `unavailable`
 * instead of being served from fixtures or guessed SQL.
 */
const pendingMembershipSource: MembershipSource = {
  async findBySubject() {
    throw new ApiError('unavailable', 'Orbit is not available yet.', 'membership_store_not_implemented');
  },
};

const app = await buildApp({
  logger: true,
  allowedOrigins: config.allowedOrigins,
  modules: pendingModuleDeps(),
  auth: {
    getKey: createRemoteJWKSet(config.jwksUrl),
    issuer: config.issuer,
    audience: config.audience,
    memberships: pendingMembershipSource,
  },
});

await app.listen({ port: config.port });
