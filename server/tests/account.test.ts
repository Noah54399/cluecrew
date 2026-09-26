import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TikTokProfileView, TikTokVideosView } from '@cluecrew/shared';
import type { ConfigOverrides } from '../src/config.js';
import { encryptString } from '../src/lib/crypto.js';
import { randomId } from '../src/lib/ids.js';
import { api, createTestContext, type TestContext } from './helpers.js';

const TIKTOK_CONFIG: ConfigOverrides = {
  tiktok: {
    clientKey: 'test-key',
    clientSecret: 'test-secret',
    scopes: ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'],
  },
};

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

/** Stubs only TikTok's API host; everything else (incl. the local test server) passes through. */
function stubTikTok(handler: (url: string) => Response | Promise<Response>): void {
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.startsWith('https://open.tiktokapis.com')) {
      return handler(url);
    }
    return originalFetch(input as Parameters<typeof fetch>[0], init);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function linkTiktok(
  ctx: TestContext,
  userId: string,
  scopes: string[],
  options: { expiresInMs?: number; refreshExpiresInMs?: number } = {},
): void {
  const now = new Date().toISOString();
  ctx.repos.oauthAccounts.save({
    id: randomId('oa'),
    userId,
    provider: 'tiktok',
    providerUserId: 'open-42',
    displayName: 'Nova',
    avatarUrl: null,
    accessTokenEnc: encryptString('act-test-token', ctx.config.tokenEncryptionKey),
    refreshTokenEnc: encryptString('rft-test-token', ctx.config.tokenEncryptionKey),
    accessTokenExpiresAt: new Date(
      Date.now() + (options.expiresInMs ?? 3_600_000),
    ).toISOString(),
    refreshTokenExpiresAt: new Date(
      Date.now() + (options.refreshExpiresInMs ?? 86_400_000),
    ).toISOString(),
    scopes: scopes.join(','),
    capabilitiesJson: '{}',
    now,
  });
}

async function createGuest(ctx: TestContext) {
  const guest = await api<{ csrfToken: string; user: { id: string } }>(
    ctx.baseUrl,
    '/api/session/guest',
    { body: { name: 'Nova' } },
  );
  return { userId: guest.body.user.id, cookie: guest.setCookie!.split(';')[0]! };
}

describe('TikTok account API (real data only)', () => {
  it('returns an empty state with the connect prompt when nothing is linked', async () => {
    const ctx = await createTestContext({ ...TIKTOK_CONFIG });
    try {
      const empty = await api<TikTokProfileView>(ctx.baseUrl, '/api/tiktok/profile');
      expect(empty.status).toBe(200);
      expect(empty.body.connected).toBe(false);
      expect(empty.body.message).toBe('Connect your TikTok account to see your real data.');
      expect(empty.body.stats).toBeNull();

      const videos = await api<TikTokVideosView>(ctx.baseUrl, '/api/tiktok/videos');
      expect(videos.body.available).toBe(false);
      expect(videos.body.videos).toEqual([]);
      expect(videos.body.reason).toMatch(/connect your tiktok account/i);
    } finally {
      await ctx.close();
    }
  });

  it('serves the real profile and statistics from the Display API', async () => {
    const ctx = await createTestContext({ ...TIKTOK_CONFIG });
    try {
      const { userId, cookie } = await createGuest(ctx);
      linkTiktok(ctx, userId, ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list']);

      const calls: string[] = [];
      stubTikTok((url) => {
        calls.push(url);
        return jsonResponse({
          data: {
            user: {
              open_id: 'open-42',
              display_name: 'Nova Real',
              avatar_url: 'https://p16.tiktokcdn.com/avatar.jpg',
              username: 'nova',
              bio_description: 'party game enjoyer',
              profile_deep_link: 'https://www.tiktok.com/@nova',
              is_verified: false,
              follower_count: 4242,
              following_count: 42,
              likes_count: 9999,
              video_count: 7,
            },
          },
          error: { code: 'ok' },
        });
      });

      const profile = await api<TikTokProfileView>(ctx.baseUrl, '/api/tiktok/profile', { cookie });
      expect(profile.status).toBe(200);
      expect(profile.body.connected).toBe(true);
      expect(profile.body.needsReconnect).toBe(false);
      expect(profile.body.displayName).toBe('Nova Real');
      expect(profile.body.stats).toEqual({
        followerCount: 4242,
        followingCount: 42,
        likesCount: 9999,
        videoCount: 7,
      });
      expect(profile.body.username).toBe('nova');
      expect(calls[0]).toContain('/v2/user/info/');
      expect(calls[0]).toContain('follower_count');
    } finally {
      await ctx.close();
    }
  });

  it('reports unavailable fields with the exact required scope instead of inventing values', async () => {
    const ctx = await createTestContext({ ...TIKTOK_CONFIG });
    try {
      const { userId, cookie } = await createGuest(ctx);
      // Only basic + video.list granted: stats/profile scopes missing.
      linkTiktok(ctx, userId, ['user.info.basic', 'video.list']);
      stubTikTok(() =>
        jsonResponse({
          data: { user: { open_id: 'open-42', display_name: 'Nova', avatar_url: null } },
          error: { code: 'ok' },
        }),
      );

      const profile = await api<TikTokProfileView>(ctx.baseUrl, '/api/tiktok/profile', { cookie });
      expect(profile.body.stats).toBeNull();
      expect(profile.body.username).toBeNull();
      const requiredScopes = profile.body.unavailable.map((entry) => entry.requiredScope);
      expect(requiredScopes).toContain('user.info.stats');
      expect(requiredScopes).toContain('user.info.profile');
    } finally {
      await ctx.close();
    }
  });

  it('serves real videos with real statistics', async () => {
    const ctx = await createTestContext({ ...TIKTOK_CONFIG });
    try {
      const { userId, cookie } = await createGuest(ctx);
      linkTiktok(ctx, userId, ['user.info.basic', 'video.list']);
      stubTikTok(() =>
        jsonResponse({
          data: {
            videos: [
              {
                id: '7080213458555737986',
                title: 'my real clip',
                cover_image_url: 'https://p16-sign-sg.tiktokcdn.com/cover.jpg',
                share_url: 'https://www.tiktok.com/@nova/video/7080213458555737986',
                create_time: 1_700_000_000,
                duration: 15,
                view_count: 1500,
                like_count: 200,
                comment_count: 12,
                share_count: 3,
              },
            ],
            cursor: 1,
            has_more: false,
          },
          error: { code: 'ok' },
        }),
      );

      const videos = await api<TikTokVideosView>(ctx.baseUrl, '/api/tiktok/videos', { cookie });
      expect(videos.status).toBe(200);
      expect(videos.body.available).toBe(true);
      expect(videos.body.videos).toHaveLength(1);
      expect(videos.body.videos[0]).toMatchObject({
        id: '7080213458555737986',
        title: 'my real clip',
        viewCount: 1500,
        likeCount: 200,
        commentCount: 12,
      });
      // Covers are routed through the signed media proxy, never hotlinked.
      expect(videos.body.videos[0]!.coverUrl).toContain('/api/media/proxy');
    } finally {
      await ctx.close();
    }
  });

  it('flags expired/invalid tokens so the UI can show the reconnect state', async () => {
    const ctx = await createTestContext({ ...TIKTOK_CONFIG });
    try {
      const { userId, cookie } = await createGuest(ctx);
      // Expired access token + valid refresh token → TikTok rejects → reconnect required.
      linkTiktok(ctx, userId, ['user.info.basic', 'video.list'], { expiresInMs: -60_000 });
      stubTikTok((url) => {
        if (url.includes('/v2/oauth/token/')) {
          return jsonResponse({ error: 'invalid_grant', error_description: 'refresh token revoked' });
        }
        return jsonResponse({ error: { code: 'access_token_invalid' } }, 401);
      });

      const profile = await api<TikTokProfileView>(ctx.baseUrl, '/api/tiktok/profile', { cookie });
      expect(profile.body.connected).toBe(true);
      expect(profile.body.needsReconnect).toBe(true);
      expect(profile.body.message).toMatch(/reconnect/i);

      const videos = await api<TikTokVideosView>(ctx.baseUrl, '/api/tiktok/videos', { cookie });
      expect(videos.body.available).toBe(false);
      expect(videos.body.needsReconnect).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('explains that video.list is required when the account did not grant it', async () => {
    const ctx = await createTestContext({ ...TIKTOK_CONFIG });
    try {
      const { userId, cookie } = await createGuest(ctx);
      linkTiktok(ctx, userId, ['user.info.basic']);
      const videos = await api<TikTokVideosView>(ctx.baseUrl, '/api/tiktok/videos', { cookie });
      expect(videos.body.available).toBe(false);
      expect(videos.body.reason).toMatch(/video\.list/);
      expect(videos.body.videos).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  it('publishes only real-data configuration (no mock flag) in /api/config', async () => {
    const ctx = await createTestContext({ ...TIKTOK_CONFIG });
    try {
      const config = await api<Record<string, unknown> & { tiktokScopes: string[] }>(
        ctx.baseUrl,
        '/api/config',
      );
      expect(config.body.tiktokScopes).toContain('video.list');
      expect('mockProviderAllowed' in config.body).toBe(false);
      expect(JSON.stringify(config.body)).not.toContain('test-secret');
    } finally {
      await ctx.close();
    }
  });
});
