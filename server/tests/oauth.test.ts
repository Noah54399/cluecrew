import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openAppDatabase } from '../src/database/db.js';
import { createRepositories } from '../src/database/repositories.js';
import { TikTokOAuthService, sanitizeReturnTo } from '../src/auth/tiktokOAuth.js';
import { AppError } from '../src/lib/errors.js';
import { appEvents } from '../src/lib/events.js';

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return String((input as { url?: string }).url ?? input);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeService(scopes = 'user.info.basic,video.list') {
  const config = loadConfig({
    nodeEnv: 'test',
    databasePath: ':memory:',
    publicUrl: 'https://game.example',
    clientUrl: 'https://app.example',
    allowedOrigins: ['https://app.example'],
    tiktok: {
      configured: true,
      clientKey: 'test-client-key',
      clientSecret: 'test-client-secret',
      redirectUri: 'https://game.example/api/auth/tiktok/callback',
      scopes: ['user.info.basic', 'video.list'],
    },
  });
  const db = openAppDatabase(config);
  const repos = createRepositories(db);
  const service = new TikTokOAuthService(config, repos);
  const now = new Date().toISOString();
  repos.users.create({ id: 'usr_1', displayName: 'Nova', avatarSeed: 0, now });
  let stubbedScopes = scopes;
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = urlOf(input);
    if (url.includes('/v2/oauth/token/')) {
      return jsonResponse({
        access_token: 'act_secret_token',
        expires_in: 86400,
        open_id: 'open-42',
        refresh_expires_in: 31536000,
        refresh_token: 'rft_secret_token',
        scope: stubbedScopes,
        token_type: 'Bearer',
      });
    }
    if (url.includes('/v2/user/info/')) {
      return jsonResponse({
        data: { user: { open_id: 'open-42', display_name: 'Nova From TikTok' } },
        error: { code: 'ok' },
      });
    }
    if (url.includes('/v2/oauth/revoke/')) {
      return jsonResponse({});
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  return {
    service,
    repos,
    db,
    setScopes: (value: string) => {
      stubbedScopes = value;
    },
    close: () => db.close(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitizeReturnTo', () => {
  it('only allows internal paths', () => {
    expect(sanitizeReturnTo('/room/ABC123')).toBe('/room/ABC123');
    expect(sanitizeReturnTo('https://evil.example/steal')).toBe('/');
    expect(sanitizeReturnTo('//evil.example')).toBe('/');
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/');
    expect(sanitizeReturnTo(undefined)).toBe('/');
  });
});

describe('TikTok OAuth service', () => {
  it('builds an official authorization URL with a stored one-time state', () => {
    const ctx = makeService();
    const url = new URL(ctx.service.createAuthorizeUrl({ userId: 'usr_1', returnTo: '/room/ABC123' }));
    expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(url.searchParams.get('client_key')).toBe('test-client-key');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('user.info.basic,video.list');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://game.example/api/auth/tiktok/callback',
    );
    expect(url.searchParams.get('state')).toBeTruthy();
    ctx.close();
  });

  it('rejects unknown, reused and expired state values', async () => {
    const ctx = makeService();
    await expect(
      ctx.service.handleCallback({ code: 'c', state: 'forged-state' }),
    ).rejects.toMatchObject({ code: 'TIKTOK_STATE_INVALID' });

    const url = new URL(ctx.service.createAuthorizeUrl({ userId: 'usr_1', returnTo: '/' }));
    const state = url.searchParams.get('state')!;

    const events: string[] = [];
    const unsubscribe = appEvents.on('tiktok:linked', () => events.push('linked'));
    const result = await ctx.service.handleCallback({ code: 'code-1', state });
    unsubscribe();
    expect(result.returnTo).toBe('/');
    expect(events).toEqual(['linked']);

    // State is one-time use.
    await expect(ctx.service.handleCallback({ code: 'code-1', state })).rejects.toMatchObject({
      code: 'TIKTOK_STATE_INVALID',
    });
    ctx.close();
  });

  it('stores tokens encrypted and never in plaintext', async () => {
    const ctx = makeService();
    const url = new URL(ctx.service.createAuthorizeUrl({ userId: 'usr_1', returnTo: '/' }));
    const state = url.searchParams.get('state')!;
    await ctx.service.handleCallback({ code: 'code-1', state });

    const account = ctx.repos.oauthAccounts.getForUser('usr_1', 'tiktok');
    expect(account).not.toBeNull();
    expect(account!.accessTokenEnc).not.toContain('act_secret_token');
    expect(account!.refreshTokenEnc).not.toContain('rft_secret_token');
    expect(account!.accessTokenEnc).toMatch(/^v1\./);
    expect(account!.scopes).toContain('video.list');

    const summary = ctx.service.getLinkedAccount('usr_1');
    expect(summary.linked).toBe(true);
    expect(summary.canSupply.post).toBe(true);
    expect(summary.canSupply.like).toBe(false);
    ctx.close();
  });

  it('surfaces provider errors and missing scopes as clean AppErrors', async () => {
    const ctx = makeService('video.list');
    const url = new URL(ctx.service.createAuthorizeUrl({ userId: 'usr_1', returnTo: '/' }));
    const state = url.searchParams.get('state')!;
    await expect(ctx.service.handleCallback({ code: 'code-1', state })).rejects.toBeInstanceOf(
      AppError,
    );

    const ctx2 = makeService();
    const url2 = new URL(ctx2.service.createAuthorizeUrl({ userId: 'usr_1', returnTo: '/' }));
    const state2 = url2.searchParams.get('state')!;
    await expect(
      ctx2.service.handleCallback({ code: '', state: state2, error: 'access_denied' }),
    ).rejects.toMatchObject({ code: 'TIKTOK_AUTH_FAILED' });
    ctx.close();
    ctx2.close();
  });

  it('disconnects by revoking and deleting the stored account', async () => {
    const ctx = makeService();
    const url = new URL(ctx.service.createAuthorizeUrl({ userId: 'usr_1', returnTo: '/' }));
    const state = url.searchParams.get('state')!;
    await ctx.service.handleCallback({ code: 'code-1', state });

    await ctx.service.disconnect('usr_1');
    expect(ctx.repos.oauthAccounts.getForUser('usr_1', 'tiktok')).toBeNull();
    expect(ctx.service.getLinkedAccount('usr_1').linked).toBe(false);
    ctx.close();
  });
});
