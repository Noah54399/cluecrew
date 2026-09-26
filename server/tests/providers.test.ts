import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockSocialProvider } from '../src/providers/mock/MockSocialProvider.js';
import { TikTokProvider } from '../src/providers/tiktok/TikTokProvider.js';
import {
  UnsupportedCapabilityError,
} from '../src/providers/types.js';

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

describe('MockSocialProvider', () => {
  it('generates deterministic, clearly labelled demo content', async () => {
    const provider = new MockSocialProvider({
      playerKey: 'player-1',
      displayName: 'Nova',
      avatarSeed: 0,
      enabled: true,
    });
    const first = await provider.getAvailableLikedContent(5);
    const second = await provider.getAvailableLikedContent(5);
    expect(first).toHaveLength(5);
    expect(first.map((item) => item.contentId)).toEqual(second.map((item) => item.contentId));
    for (const item of first) {
      expect(item.provider).toBe('mock');
      expect(item.kind).toBe('like');
      expect(item.coverUrl).toMatch(/^data:image\/svg\+xml/);
      expect(item.webUrl).toBeNull();
    }
  });

  it('gives different players different pools', async () => {
    const a = new MockSocialProvider({ playerKey: 'a', displayName: 'A', avatarSeed: 0, enabled: true });
    const b = new MockSocialProvider({ playerKey: 'b', displayName: 'B', avatarSeed: 0, enabled: true });
    const idsA = (await a.getAvailableLikedContent(10)).map((item) => item.contentId);
    const idsB = (await b.getAvailableLikedContent(10)).map((item) => item.contentId);
    expect(idsA.some((id) => idsB.includes(id))).toBe(false);
  });

  it('supports every mode with an honest reason string', () => {
    const provider = new MockSocialProvider({
      playerKey: 'a',
      displayName: 'A',
      avatarSeed: 0,
      enabled: true,
    });
    const capabilities = provider.getCapabilities();
    for (const capability of Object.values(capabilities)) {
      expect(capability.available).toBe(true);
      expect(capability.reason.toLowerCase()).toContain('demo data');
    }
  });

  it('reports unavailable capabilities when demo data is disabled', async () => {
    const provider = new MockSocialProvider({
      playerKey: 'a',
      displayName: 'A',
      avatarSeed: 0,
      enabled: false,
      disabledReason: 'Demo disabled by policy.',
    });
    const capabilities = provider.getCapabilities();
    expect(capabilities.like.available).toBe(false);
    expect(capabilities.post.reason).toBe('Demo disabled by policy.');
    await expect(provider.getAvailableLikedContent(5)).rejects.toBeInstanceOf(
      UnsupportedCapabilityError,
    );
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

  it('maps the video list into display-ready content items', async () => {
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = urlOf(input);
      expect(url).toContain('/v2/video/list/');
      return jsonResponse({
        data: {
          videos: [
            {
              id: '7080213458555737986',
              title: 'my video',
              cover_image_url: 'https://p16-sign-sg.tiktokcdn.com/cover.jpg',
              share_url: 'https://www.tiktok.com/@nova/video/7080213458555737986',
              create_time: 1_700_000_000,
            },
          ],
          cursor: 123,
          has_more: false,
        },
        error: { code: 'ok' },
      });
    });

    const provider = new TikTokProvider(baseOptions);
    const items = await provider.getAvailablePostedContent(5);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      provider: 'tiktok',
      kind: 'post',
      contentId: '7080213458555737986',
      title: 'my video',
      authorName: 'Nova',
    });
    expect(items[0]!.createdAt).toBe(1_700_000_000_000);
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
