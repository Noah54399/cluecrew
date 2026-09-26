import { afterEach, describe, expect, it } from 'vitest';
import { BRAND } from '@cluecrew/shared';
import { loadConfig } from '../src/config.js';
import { api, createTestContext } from './helpers.js';

const MANAGED_ENV = [
  'FRONTEND_URL',
  'BACKEND_URL',
  'SESSION_SECRET',
  'DATABASE_URL',
  'DATABASE_PATH',
  'TOKEN_ENCRYPTION_KEY',
  'TIKTOK_REDIRECT_URI',
  'APP_VERSION',
  'RENDER_EXTERNAL_URL',
];

afterEach(() => {
  for (const name of MANAGED_ENV) delete process.env[name];
});

describe('production environment configuration', () => {
  it('honours FRONTEND_URL / BACKEND_URL / SESSION_SECRET / DATABASE_URL / APP_VERSION', () => {
    process.env.FRONTEND_URL = 'https://cluecrew.example';
    process.env.BACKEND_URL = 'https://api.cluecrew.example';
    process.env.SESSION_SECRET = 'ab'.repeat(32);
    process.env.DATABASE_URL = 'file:./data/prod.sqlite';
    process.env.APP_VERSION = '9.9.9';

    const config = loadConfig({ nodeEnv: 'production' });
    expect(config.clientUrl).toBe('https://cluecrew.example');
    expect(config.publicUrl).toBe('https://api.cluecrew.example');
    // Different sites + production => SameSite=None (Secure) cookies.
    expect(config.cookieSameSite).toBe('None');
    expect(config.databasePath.endsWith('prod.sqlite')).toBe(true);
    expect(config.appVersion).toBe('9.9.9');
    expect(config.tokenEncryptionKey).toHaveLength(32);
    expect(config.tiktok.redirectUri).toBe(
      'https://api.cluecrew.example/api/auth/tiktok/callback',
    );
  });

  it('derives the public URL from RENDER_EXTERNAL_URL for zero-config Blueprint deploys', () => {
    process.env.RENDER_EXTERNAL_URL = 'https://cluecrew.onrender.com';
    process.env.TOKEN_ENCRYPTION_KEY = 'ef'.repeat(32);

    const config = loadConfig({ nodeEnv: 'production' });
    expect(config.publicUrl).toBe('https://cluecrew.onrender.com');
    expect(config.clientUrl).toBe('https://cluecrew.onrender.com');
    // Same origin => first-party cookies, no third-party-cookie problems.
    expect(config.cookieSameSite).toBe('Lax');
    expect(config.tiktok.redirectUri).toBe(
      'https://cluecrew.onrender.com/api/auth/tiktok/callback',
    );
    expect(config.allowedOrigins).toContain('https://cluecrew.onrender.com');

    // Explicit configuration always wins over the platform default.
    process.env.BACKEND_URL = 'https://api.example.com';
    const explicit = loadConfig({ nodeEnv: 'production' });
    expect(explicit.publicUrl).toBe('https://api.example.com');
    expect(explicit.clientUrl).toBe('https://cluecrew.onrender.com');
  });

  it('accepts platform-generated (non-hex) secrets by deriving a stable key', () => {
    // Render's generateValue produces a base64 value like this one.
    process.env.TOKEN_ENCRYPTION_KEY = 'bBSD8dAmfMm8WQGlpbw5KWFFvlLO9ys64inFLIkf2RU=';
    const config = loadConfig({ nodeEnv: 'production' });
    expect(config.tokenEncryptionKey).toHaveLength(32);

    // Derivation is deterministic, so encrypted tokens survive restarts.
    const again = loadConfig({ nodeEnv: 'production' });
    expect(again.tokenEncryptionKey.equals(config.tokenEncryptionKey)).toBe(true);

    // 64-hex keys are still used byte-for-byte.
    process.env.TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);
    const hexConfig = loadConfig({ nodeEnv: 'production' });
    expect(hexConfig.tokenEncryptionKey.toString('hex')).toBe('ab'.repeat(32));
  });

  it('refuses to start in production without any secret', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.SESSION_SECRET;
    expect(() => loadConfig({ nodeEnv: 'production' })).toThrow(/TOKEN_ENCRYPTION_KEY is required/);
  });

  it('keeps the redirect URI configurable without code changes', () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'cd'.repeat(32);
    process.env.TIKTOK_REDIRECT_URI = 'https://api.example/auth/callback';
    const config = loadConfig();
    expect(config.tiktok.redirectUri).toBe('https://api.example/auth/callback');
  });

  it('refuses a PostgreSQL DATABASE_URL with a clear message (SQLite-only build)', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@host:5432/db';
    expect(() => loadConfig()).toThrow(/PostgreSQL/i);
  });

  it('rejects unsupported portability scopes loudly', () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'cd'.repeat(32);
    expect(() =>
      loadConfig({ dataPortability: { scope: 'portability.nope.ongoing' } }),
    ).toThrow(/Unsupported TIKTOK_DATAPORTABILITY_SCOPE/);
  });

  it('maps portability scopes to the right export categories', () => {
    const all = loadConfig({
      tiktok: { clientKey: 'k', clientSecret: 's' },
      dataPortability: { enabled: true, scope: 'portability.all.ongoing' },
    });
    expect(all.tiktok.scopes).toContain('portability.all.ongoing');
    expect(all.dataPortability.enabled).toBe(true);
    expect(all.dataPortability.categories).toEqual(['all_data']);

    const activity = loadConfig({
      tiktok: { clientKey: 'k', clientSecret: 's' },
      dataPortability: { enabled: true, scope: 'portability.activity.ongoing' },
    });
    expect(activity.dataPortability.categories).toEqual(['activity']);

    // Without credentials the import must stay off, whatever the flag says.
    const noCreds = loadConfig({ dataPortability: { enabled: true } });
    expect(noCreds.dataPortability.enabled).toBe(false);
  });
});

describe('deployment endpoints', () => {
  it('serves GET /health with service metadata and no secrets', async () => {
    const ctx = await createTestContext();
    try {
      const response = await api<{ status: string; service: string; version: string }>(
        ctx.baseUrl,
        '/health',
      );
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('cluecrew');
      expect(response.body.version).toBe(BRAND.version);
      expect(JSON.stringify(response.body)).not.toMatch(/secret|clientsecret/i);
    } finally {
      await ctx.close();
    }
  });

  it('exposes Data Portability status in /api/config without secrets', async () => {
    const ctx = await createTestContext({
      tiktok: { clientKey: 'k', clientSecret: 'top-secret-value' },
      dataPortability: { enabled: true },
    });
    try {
      const response = await api<{
        dataPortability: { enabled: boolean; scope: string | null; categories: string[] };
      }>(ctx.baseUrl, '/api/config');
      expect(response.body.dataPortability.enabled).toBe(true);
      expect(response.body.dataPortability.scope).toBe('portability.all.ongoing');
      expect(response.body.dataPortability.categories).toEqual(['all_data']);
      const text = JSON.stringify(response.body);
      expect(text).not.toContain('top-secret-value');
      expect(text).not.toContain('clientSecret');
    } finally {
      await ctx.close();
    }
  });

  it('answers CORS preflight for allowed origins and blocks others', async () => {
    const ctx = await createTestContext();
    try {
      const preflight = await fetch(`${ctx.baseUrl}/api/rooms`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost', 'Access-Control-Request-Method': 'POST' },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost');
      expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');

      const blocked = await fetch(`${ctx.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Nova' }),
      });
      expect(blocked.status).toBe(403);
      expect(preflight.headers.get('access-control-allow-headers')).toContain('x-csrf-token');
    } finally {
      await ctx.close();
    }
  });
});
