import { describe, expect, it } from 'vitest';
import { loadConfig, readDesks } from '../src/config.ts';

const BASE = {
  ERP_API_URL: 'https://orbit-erp-api.example.com/',
  SUPABASE_URL: 'https://project.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_not_a_real_key',
  SIM_ADMIN_EMAIL: 'admin@kestrion.demo',
  SIM_ADMIN_PASSWORD: 'correct horse battery staple',
};

describe('simulator configuration', () => {
  it('needs only the API, Supabase and an admin account, and applies safe defaults', () => {
    const cfg = loadConfig(BASE);
    expect(cfg.erpApiUrl).toBe('https://orbit-erp-api.example.com');
    expect(cfg.supabaseUrl).toBe('https://project.supabase.co');
    expect(cfg).toMatchObject({
      tickSeconds: 60,
      paused: false,
      bootstrap: true,
      maxWritesPerTick: 60,
      rosterDaysAhead: 14,
      directorMinutes: 60,
      facilities: null,
    });
    expect(cfg.desks.size).toBe(0);
    expect(cfg.providers).toEqual([]);
    expect(cfg.port).toBeUndefined();
  });

  it('names the broken variables and never echoes a value', () => {
    expect.assertions(4);
    try {
      loadConfig({ ...BASE, SIM_ADMIN_PASSWORD: '', SIM_TICK_SECONDS: '1', ERP_API_URL: 'not a url' });
    } catch (error: unknown) {
      const message = (error as Error).message;
      expect(message).toContain('ERP_API_URL');
      expect(message).toContain('SIM_TICK_SECONDS');
      expect(message).toContain('SIM_ADMIN_PASSWORD');
      expect(message).not.toContain('not a url');
    }
  });

  it('refuses a plain http API except on localhost', () => {
    expect(() => loadConfig({ ...BASE, ERP_API_URL: 'http://api.example.com' })).toThrow(/https/);
    expect(loadConfig({ ...BASE, ERP_API_URL: 'http://localhost:3000' }).erpApiUrl).toBe('http://localhost:3000');
    expect(loadConfig({ ...BASE, ERP_API_URL: 'http://127.0.0.1:3000/' }).erpApiUrl).toBe('http://127.0.0.1:3000');
  });

  it('reads boolean and numeric settings', () => {
    const cfg = loadConfig({ ...BASE, SIM_PAUSED: 'true', SIM_BOOTSTRAP: 'no', SIM_TICK_SECONDS: '45', SIM_ABSENT_RATE: '0.1', PORT: '8080' });
    expect(cfg).toMatchObject({ paused: true, bootstrap: false, tickSeconds: 45, port: 8080 });
    expect(cfg.rates.absent).toBe(0.1);
  });

  it('keeps hospitals as lowercase keys', () => {
    expect(loadConfig({ ...BASE, SIM_FACILITIES: 'Avenhurst, BRACKMOOR' }).facilities).toEqual(['avenhurst', 'brackmoor']);
  });

  it('collects a desk account per hospital and insists on both halves', () => {
    const desks = readDesks({
      SIM_DESK_AVENHURST_EMAIL: 'desk-a@kestrion.demo',
      SIM_DESK_AVENHURST_PASSWORD: 'pw-a',
      SIM_DESK_BRACKMOOR_EMAIL: 'desk-b@kestrion.demo',
      SIM_DESK_BRACKMOOR_PASSWORD: 'pw-b',
      UNRELATED: 'x',
    });
    expect([...desks.keys()].sort()).toEqual(['avenhurst', 'brackmoor']);
    expect(desks.get('avenhurst')).toEqual({ email: 'desk-a@kestrion.demo', password: 'pw-a' });
    expect(() => readDesks({ SIM_DESK_AVENHURST_EMAIL: 'a@b.c' })).toThrow(/SIM_DESK_AVENHURST_PASSWORD/);
  });

  it('builds the model providers in order, Groq keys first, labelled without the key', () => {
    const cfg = loadConfig({
      ...BASE,
      SIM_GROQ_KEYS: 'gsk_one, gsk_two',
      SIM_OPENROUTER_KEYS: 'sk-or-one',
      SIM_OPENROUTER_MODEL: 'some/free-model:free',
    });
    expect(cfg.providers.map((provider) => provider.label)).toEqual(['groq#1', 'groq#2', 'openrouter#1']);
    expect(cfg.providers.map((provider) => provider.apiKey)).toEqual(['gsk_one', 'gsk_two', 'sk-or-one']);
    expect(cfg.providers[0]?.endpoint).toContain('groq.com');
    expect(cfg.providers[2]?.model).toBe('some/free-model:free');
    expect(cfg.providers.some((provider) => provider.label.includes('gsk'))).toBe(false);
  });

  it('refuses OpenRouter keys without a model, because there is no default on purpose', () => {
    expect(() => loadConfig({ ...BASE, SIM_OPENROUTER_KEYS: 'sk-or-one' })).toThrow(/SIM_OPENROUTER_MODEL/);
  });
});
