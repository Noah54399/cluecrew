import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisconnectedSocialProvider } from '../src/providers/DisconnectedSocialProvider.js';
import { TikTokProvider } from '../src/providers/tiktok/TikTokProvider.js';
import { UnsupportedCapabilityError } from '../src/providers/types.js';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DisconnectedSocialProvider (no TikTok connected)', () => {
  it('supplies nothing and explains exactly what to do', async () => {
    const provider = new DisconnectedSocialProvider();
    expect(provider.isConnected()).toBe(false);
    const capabilities = provider.getCapabilities();
    for (const capability of Object.values(capabilities)) {
      expect(capability.available).toBe(false);
      expect(capability.reason).toMatch(/Connect your TikTok account/i);
    }
    await expect(provider.getAvailablePostedContent(5)).rejects.toBeInstanceOf(
      UnsupportedCapabilityError,
    );
    await expect(provider.getAvailableLikedContent(5)).rejects.toMatchObject({
      code: 'CONTENT_UNAVAILABLE',
    });
    await expect(provider.getUser()).resolves.toBeNull();
  });
});

describe('TikTokProvider', () => {
  const baseOptions = {
    providerUserId: 'open-1',
    displayName: 'Nova',
    avatarUrl: null,
    scopes: ['user.info.basic', 'video.list'],
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    accessTokenExpiresAt: Date.now() + 3_600_000,
    refreshTokenExpiresAt: Date.now() + 86_400_000,
    config: {
      configured: true,
      clientKey: 'key',
      clientSecret: 'secret',
      redirectUri: 'http://localhost/callback',
      scopes: ['user.info.basic', 'video.list'],
    },
  };

  it('supports who_posted but honestly refuses likes, reposts and saves', async () => {
    const provider = new TikTokProvider(baseOptions);
    const capabilities = provider.getCapabilities();
    expect(capabilities.post.available).toBe(true);
    expect(capabilities.post.scope).toBe('video.list');
    expect(capabilities.like.available).toBe(false);
    expect(capabilities.like.reason).toMatch(/does not expose/i);
    expect(capabilities.repost.available).toBe(false);
    expect(capabilities.save.available).toBe(false);

    await expect(provider.getAvailableLikedContent(5)).rejects.toBeInstanceOf(
      UnsupportedCapabilityError,
    );
    await expect(provider.getAvailableRepostedContent(5)).rejects.toBeInstanceOf(
      UnsupportedCapabilityError,
    );
    await expect(provider.getAvailableSavedContent(5)).rejects.toBeInstanceOf(
      UnsupportedCapabilityError,
    );
  });

  it('marks who_posted unavailable without the video.list scope', () => {
    const provider = new TikTokProvider({ ...baseOptions, scopes: ['user.info.basic'] });
    const capabilities = provider.getCapabilities();
    expect(capabilities.post.available).toBe(false);
    expect(capabilities.post.reason).toMatch(/video\.list/);
  });

  it('fetches and maps the user profile through the Display API', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = urlOf(input);
      calls.push(url);
      return jsonResponse({
        data: {
          user: {
            open_id: 'open-1',
            display_name: 'Nova',
            avatar_url: 'https://p16.tiktokcdn.com/avatar.jpg',
          },
        },
        error: { code: 'ok' },
      });
    });

    const provider = new TikTokProvider(baseOptions);
    const identity = await provider.getUser();
    expect(identity?.providerUserId).toBe('open-1');
    expect(identity?.displayName).toBe('Nova');
    expect(calls[0]).toContain('/v2/user/info/');
    expect(calls[0]).toContain('avatar_url');
  });

  it('requests profile fields only for granted scopes and reports the rest as unavailable', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = urlOf(input);
      calls.push(url);
      return jsonResponse({
        data: {
          user: {
            open_id: 'open-1',
            display_name: 'Nova',
            avatar_url: 'https://p16.tiktokcdn.com/avatar.jpg',
            follower_count: 1234,
            following_count: 12,
            likes_count: 5678,
            video_count: 9,
          },
        },
        error: { code: 'ok' },
      });
    });

    const provider = new TikTokProvider({
      ...baseOptions,
      scopes: ['user.info.basic', 'video.list', 'user.info.stats'],
      config: {
        ...baseOptions.config,
        scopes: ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'],
      },
    });
    const profile = await provider.getProfile();

    expect(profile.connected).toBe(true);
    expect(profile.needsReconnect).toBe(false);
    // Real numbers straight from the API — or nothing at all, never invented.
    expect(profile.stats).toEqual({
      followerCount: 1234,
      followingCount: 12,
      likesCount: 5678,
      videoCount: 9,
    });
    expect(profile.scopesMissing).toContain('user.info.profile');
    expect(profile.unavailable.map((entry) => entry.requiredScope)).toContain(
      'user.info.profile',
    );
    expect(profile.username).toBeNull();
    expect(profile.bioDescription).toBeNull();
    // stats fields requested, non-granted profile fields not requested
    expect(calls[0]).toContain('follower_count');
    expect(calls[0]).not.toContain('bio_description');
  });

  it('reports a reconnect requirement when TikTok rejects the stored authorization', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        { error: { code: 'access_token_invalid', message: 'Token expired', log_id: 'x' } },
        401,
      ),
    );
    const provider = new TikTokProvider(baseOptions);
    const profile = await provider.getProfile();
    expect(profile.connected).toBe(true);
    expect(profile.needsReconnect).toBe(true);
    expect(profile.message).toMatch(/reconnect/i);
  });

  it('maps own videos with their real statistics and proxied covers', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse({
        data: {
          videos: [
            {
              id: '7080213458555737986',
              title: 'my clip',
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
          cursor: 123,
          has_more: false,
        },
        error: { code: 'ok' },
      }),
    );

    const provider = new TikTokProvider({
      ...baseOptions,
      mapMediaUrl: (url) =>
        url ? `/api/media/proxy?u=${encodeURIComponent(url)}&s=sig` : null,
    });
    const result = await provider.getVideos(10);
    expect(result.available).toBe(true);
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0]).toMatchObject({
      id: '7080213458555737986',
      title: 'my clip',
      viewCount: 1500,
      likeCount: 200,
      commentCount: 12,
      shareCount: 3,
      durationSeconds: 15,
    });
    expect(result.videos[0]!.coverUrl).toContain('/api/media/proxy');
    expect(result.videos[0]!.createdAt).toBe(1_700_000_000_000);
  });

  it('explains that video.list is required when it was not granted', async () => {
    const provider = new TikTokProvider({ ...baseOptions, scopes: ['user.info.basic'] });
    const result = await provider.getVideos(10);
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/video\.list/);
    expect(result.videos).toHaveLength(0);
  });

  it('refreshes an expired access token and reports the new tokens', async () => {
    let refreshed: { accessToken: string; scopes: string[] } | null = null;
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = urlOf(input);
      if (url.includes('/v2/oauth/token/')) {
        return jsonResponse({
          access_token: 'access-2',
          expires_in: 86400,
          open_id: 'open-1',
          refresh_expires_in: 31536000,
          refresh_token: 'refresh-2',
          scope: 'user.info.basic,video.list',
          token_type: 'Bearer',
        });
      }
      return jsonResponse({
        data: { user: { open_id: 'open-1', display_name: 'Nova' } },
        error: { code: 'ok' },
      });
    });

    const provider = new TikTokProvider({
      ...baseOptions,
      accessToken: 'expired',
      accessTokenExpiresAt: Date.now() - 1000,
      onTokensRefreshed: (tokens) => {
        refreshed = { accessToken: tokens.accessToken, scopes: tokens.scopes };
      },
    });

    const identity = await provider.authenticate();
    expect(identity.displayName).toBe('Nova');
    expect(refreshed).not.toBeNull();
    expect(refreshed!.accessToken).toBe('access-2');
    expect(refreshed!.scopes).toContain('video.list');
  });
});
