import { createServer } from 'node:http';
import { createTokenManager } from './auth.ts';
import { systemClock } from './clock.ts';
import { loadConfig, type Credentials, type SimConfig } from './config.ts';
import { createDirector } from './director.ts';
import { createErpApi, type ErpApi } from './erp-client.ts';
import { createSimulator, type TickSummary } from './engine.ts';
import { createLogger } from './log.ts';

/*
 * Entry point. `npm start` runs until it is stopped (Ctrl+C locally, a stop or
 * redeploy on Render or Railway). `--once` runs a single tick and exits, for a
 * scheduler such as GitHub Actions.
 *
 * Stopping it is the only off switch needed: nothing it did is undone, and
 * starting it again carries on from whatever time it is then. SIM_PAUSED=true
 * keeps it running but writing nothing.
 */

const log = createLogger();

function apiFor(cfg: SimConfig, credentials: Credentials): ErpApi {
  const tokens = createTokenManager({ supabaseUrl: cfg.supabaseUrl, publishableKey: cfg.supabaseKey, credentials });
  return createErpApi({ baseUrl: cfg.erpApiUrl, tokens });
}

const sleepSlices = async (ms: number, stopped: () => boolean) => {
  for (let waited = 0; waited < ms && !stopped(); waited += 500) {
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(500, ms - waited)));
  }
};

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  let cfg: SimConfig;
  try {
    cfg = loadConfig();
    // Three intervals: covers a scheduled run that starts late or is skipped once.
    if (once) cfg = { ...cfg, serviceLookbackSeconds: cfg.tickSeconds * 3 };
  } catch (error: unknown) {
    log.error('configuration error', { message: error instanceof Error ? error.message : 'unknown' });
    process.exit(1);
  }

  const admin = apiFor(cfg, cfg.admin);
  const desks = new Map([...cfg.desks].map(([key, credentials]) => [key, apiFor(cfg, credentials)] as const));
  const director = createDirector({ providers: cfg.providers, log });
  const simulator = createSimulator({ cfg, clock: systemClock, log, admin, desks, director });

  log.info('simulator starting', {
    erpApi: new URL(cfg.erpApiUrl).host,
    tickSeconds: cfg.tickSeconds,
    deskAccounts: desks.size,
    directorProviders: cfg.providers.length,
    paused: cfg.paused,
    once,
  });

  let stopped = false;
  let lastTick: (TickSummary & { at: string }) | null = null;
  let failures = 0;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (!stopped) log.info('stopping after the current tick', { signal });
      stopped = true;
    });
  }

  if (cfg.port !== undefined && !once) {
    createServer((request, response) => {
      const healthy = failures < 5;
      response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', paused: cfg.paused, consecutiveFailures: failures, lastTick }));
      void request;
    }).listen(cfg.port, () => log.info('health endpoint listening', { port: cfg.port }));
  }

  let quietTicks = 0;
  while (!stopped) {
    try {
      const summary = await simulator.tick();
      failures = 0;
      lastTick = { ...summary, at: new Date().toISOString() };
      const { stats } = summary;
      const active = stats.writes > 0 || stats.failures > 0;
      quietTicks = active ? 0 : quietTicks + 1;
      // Quiet ticks are summarised every ~10 minutes rather than logged each time.
      if (active || quietTicks % Math.max(1, Math.round(600 / cfg.tickSeconds)) === 1) {
        log.info('tick', { tick: summary.tick, date: summary.today, mood: summary.mood, ...stats });
      }
    } catch (error: unknown) {
      failures += 1;
      const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : undefined;
      log.error('tick failed', { consecutiveFailures: failures, message: error instanceof Error ? error.message : 'unknown', status });
    }
    if (once) break;
    // Back off while failing (sign-in or the API is down), up to five minutes.
    await sleepSlices(Math.min(300_000, cfg.tickSeconds * 1000 * 2 ** Math.min(failures, 5)), () => stopped);
  }
  log.info('simulator stopped');
  process.exit(once && failures > 0 ? 1 : 0);
}

await main();
