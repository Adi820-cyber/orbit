import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const base = { SUPABASE_URL: 'https://fixture-project.supabase.co' };

describe('loadConfig', () => {
  it('derives issuer and JWKS URL from SUPABASE_URL', () => {
    const config = loadConfig({ ...base, SUPABASE_URL: 'https://fixture-project.supabase.co/' });
    expect(config.issuer).toBe('https://fixture-project.supabase.co/auth/v1');
    expect(config.audience).toBe('authenticated');
    expect(config.jwksUrl.href).toBe('https://fixture-project.supabase.co/auth/v1/.well-known/jwks.json');
    expect(config.allowedOrigins).toEqual([]);
    expect(config.port).toBe(3000);
  });

  it('prefers an explicit SUPABASE_JWKS_URL', () => {
    const config = loadConfig({ ...base, SUPABASE_JWKS_URL: 'https://keys.fixture.example/jwks.json' });
    expect(config.jwksUrl.href).toBe('https://keys.fixture.example/jwks.json');
  });

  it('parses exact origins', () => {
    const config = loadConfig({ ...base, ALLOWED_ORIGINS: 'https://a.example, http://localhost:5173' });
    expect(config.allowedOrigins).toEqual(['https://a.example', 'http://localhost:5173']);
  });

  it.each(['https://*.vercel.app', 'https://a.example/path', '*'])('rejects non-exact origin %s', (origin) => {
    expect(() => loadConfig({ ...base, ALLOWED_ORIGINS: origin })).toThrow();
  });

  it('names missing variables without echoing values', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://user:hunter2@host/db' })).toThrow(/SUPABASE_URL/);
    try {
      loadConfig({ SUPABASE_URL: 'not a url', DATABASE_URL: 'postgresql://user:hunter2@host/db' });
    } catch (error) {
      expect(String(error)).not.toContain('hunter2');
      expect(String(error)).not.toContain('not a url');
    }
  });

  it('keeps every source fail-closed unless ORBIT_LIVE_SOURCES names it', () => {
    expect(loadConfig(base).liveSources.size).toBe(0);
    const config = loadConfig({ ...base, DATABASE_URL: 'postgresql://x', ORBIT_LIVE_SOURCES: ' memberships , scope ' });
    expect([...config.liveSources]).toEqual(['memberships', 'scope']);
  });

  it('rejects an unknown source name instead of ignoring it', () => {
    expect(() => loadConfig({ ...base, ORBIT_LIVE_SOURCES: 'memberships,everything' })).toThrow(/everything/);
  });

  it('requires DATABASE_URL for a database source, but not for transitions', () => {
    expect(() => loadConfig({ ...base, ORBIT_LIVE_SOURCES: 'entitlements' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, ORBIT_LIVE_SOURCES: 'entities' })).toThrow(/DATABASE_URL/);
    expect([...loadConfig({ ...base, ORBIT_LIVE_SOURCES: 'transitions' }).liveSources]).toEqual(['transitions']);
  });
});

/**
 * Ask narration providers (ADR 0014). The important cases are the negative ones:
 * a missing or half-configured provider must degrade to "no narration", never
 * boot into a half-wired state, and never appear in an error message.
 */
describe('ask narration providers', () => {
  it('configures none by default, leaving Ask fully deterministic', () => {
    expect(loadConfig(base).askProviders).toEqual([]);
  });

  it('configures Groq alone, with the generally available default model', () => {
    const providers = loadConfig({ ...base, GROQ_API_KEY: 'test-key' }).askProviders;
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      name: 'groq',
      // Not llama-3.3-70b-versatile: that is Enterprise-only and would 4xx.
      model: 'openai/gpt-oss-20b',
      strict: true,
    });
  });

  it('honours an explicit Groq model', () => {
    const providers = loadConfig({ ...base, GROQ_API_KEY: 'k', GROQ_MODEL: 'openai/gpt-oss-120b' }).askProviders;
    expect(providers[0]?.model).toBe('openai/gpt-oss-120b');
  });

  /**
   * OpenRouter has no default model on purpose: structured-output support is per
   * endpoint, so guessing one would be guessing about a specific endpoint's
   * capability. A key with no model is not configured, rather than silently
   * routed somewhere arbitrary.
   */
  it('ignores an OpenRouter key with no model rather than guessing one', () => {
    expect(loadConfig({ ...base, OPENROUTER_API_KEY: 'k' }).askProviders).toEqual([]);
  });

  it('ignores an OpenRouter model with no key', () => {
    expect(loadConfig({ ...base, OPENROUTER_MODEL: 'openai/gpt-4.1-nano' }).askProviders).toEqual([]);
  });

  it('orders Groq before OpenRouter when both are configured', () => {
    const providers = loadConfig({
      ...base,
      GROQ_API_KEY: 'k1',
      OPENROUTER_API_KEY: 'k2',
      OPENROUTER_MODEL: 'openai/gpt-4.1-nano',
    }).askProviders;
    expect(providers.map((provider) => provider.name)).toEqual(['groq', 'openrouter']);
    expect(providers[1]).toMatchObject({ requireParameters: true });
  });

  it('never puts a key value in the error message for an unrelated failure', () => {
    // Config errors name variables only. A key must not be echoed while
    // reporting something else that is wrong.
    try {
      loadConfig({ SUPABASE_URL: 'not a url', GROQ_API_KEY: 'super-secret-value' });
      expect.unreachable('expected loadConfig to throw');
    } catch (error: unknown) {
      expect(String(error)).not.toContain('super-secret-value');
      expect(String(error)).toContain('SUPABASE_URL');
    }
  });
});
