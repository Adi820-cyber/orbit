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

const app: FastifyInstance = await buildApp({
  logger: true,
  allowedOrigins: config.allowedOrigins,
  modules: sources.modules,
  auth: {
    getKey: createRemoteJWKSet(config.jwksUrl),
    issuer: config.issuer,
    audience: config.audience,
    memberships: sources.memberships,
  },
});

await app.listen({ port: config.port });
