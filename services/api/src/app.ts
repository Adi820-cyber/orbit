import type { FastifyInstance } from 'fastify';
import { createRemoteJWKSet } from 'jose';
import { buildApp } from './build.ts';
import { loadConfig } from './config.ts';
import { wireSources } from './wiring.ts';

// Vercel entrypoint (src/app.ts). The app is built in ./build.ts. Vercel's
// Fastify detection needs this file itself to import fastify.
const config = loadConfig();

/**
 * Each data source is fail-closed (`503 unavailable`) unless
 * `ORBIT_LIVE_SOURCES` switches it on; see ./wiring.ts. Nothing is served from
 * fixtures or guessed SQL.
 */
const sources = wireSources(config);

// No top-level await: Vercel's runtime may load this module with require(),
// which Node rejects for ES modules that use top-level await.
buildApp({
  logger: true,
  allowedOrigins: config.allowedOrigins,
  modules: sources.modules,
  auth: {
    getKey: createRemoteJWKSet(config.jwksUrl),
    issuer: config.issuer,
    audience: config.audience,
    memberships: sources.memberships,
  },
})
  .then((app: FastifyInstance) => app.listen({ port: config.port }))
  .catch((error: unknown) => {
    console.error('Orbit API failed to start', error);
    process.exit(1);
  });
