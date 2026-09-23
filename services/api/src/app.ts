import { createRemoteJWKSet } from 'jose';
import { buildApp } from './build.ts';
import { loadConfig } from './config.ts';
import { wireSources } from './wiring.ts';

// Vercel entrypoint (src/app.ts). The app is built in ./build.ts.
const config = loadConfig();

/**
 * Each data source is fail-closed (`503 unavailable`) unless
 * `ORBIT_LIVE_SOURCES` switches it on; see ./wiring.ts. Nothing is served from
 * fixtures or guessed SQL.
 */
const sources = wireSources(config);

const app = await buildApp({
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
