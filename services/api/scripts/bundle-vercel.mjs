/**
 * Vercel build step for the API (ARCHITECTURE.md §11.1).
 *
 * The workspace packages (@orbit/contracts, @orbit/kpi-framework) publish
 * TypeScript source. Vercel transpiles the API's own files but not files under
 * node_modules, and Node will not strip types there either, so the deployed
 * function could not load them. This bundles src/app.ts with the workspace
 * packages into src/app.js; every npm dependency stays external and is traced
 * by Vercel as usual. The build command then removes src/app.ts so Vercel's
 * Fastify detection finds the bundle.
 *
 * Runs only on Vercel (`buildCommand` in vercel.json). Local development keeps
 * running the TypeScript source directly.
 */
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = fileURLToPath(new URL('..', import.meta.url));

const isBareNpmImport = (id) =>
  !id.startsWith('.') && !id.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(id) && !id.startsWith('@orbit/') && !id.startsWith('\0');

await build({
  cwd: root,
  input: 'src/app.ts',
  platform: 'node',
  external: isBareNpmImport,
  output: { file: 'src/app.js', format: 'esm' },
});
console.log('Bundled src/app.ts with workspace packages into src/app.js');
