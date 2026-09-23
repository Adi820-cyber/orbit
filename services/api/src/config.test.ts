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
