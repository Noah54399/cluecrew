import type { TikTokProfileView, TikTokVideosView } from '@cluecrew/shared';
import type { ServerConfig } from '../../config.js';
import type { OauthAccountRow } from '../../database/repositories.js';
import { createTikTokProviderForAccount } from '../factory.js';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();

/** Clears cached account data (e.g. after connect/disconnect/reconnect). */
export function clearAccountCache(userId?: string): void {
  if (!userId) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fn();
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export interface AccountDataParams {
  account: OauthAccountRow;
  config: ServerConfig;
  onTokensRefreshed?: (tokens: {
    accessToken: string;
    refreshToken: string | null;
    accessTokenExpiresAt: number;
    refreshTokenExpiresAt: number | null;
    scopes: string[];
  }) => void;
}

function offlineProfile(reason: string): TikTokProfileView {
  return {
    connected: true,
    needsReconnect: true,
    openId: null,
    displayName: null,
    avatarUrl: null,
    username: null,
    bioDescription: null,
    profileDeepLink: null,
    isVerified: null,
    stats: null,
    scopesRequested: [],
    scopesGranted: [],
    scopesMissing: [],
    unavailable: [],
    connectedAt: null,
    accessTokenExpiresAt: null,
    message: reason,
  };
}

/**
 * Loads the real TikTok profile for the account page. Cached briefly to stay
 * well within TikTok's rate limits.
 */
export async function loadTikTokProfile(params: AccountDataParams): Promise<TikTokProfileView> {
  const { account, config } = params;
  const key = `${account.userId}:profile`;
  return cached(key, async () => {
    const provider = createTikTokProviderForAccount(params);
    if (!provider) {
      return offlineProfile(
        'Your stored TikTok connection could not be used. Please reconnect your TikTok account.',
      );
    }
    const profile = await provider.getProfile();
    return {
      ...profile,
      connectedAt: account.connectedAt,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
    };
  });
}

/** Loads the connected account's own public videos (real data, real stats). */
export async function loadTikTokVideos(
  params: AccountDataParams & { limit?: number },
): Promise<TikTokVideosView> {
  const { account } = params;
  const limit = Math.max(1, Math.min(params.limit ?? 20, 40));
  const key = `${account.userId}:videos:${limit}`;
  return cached(key, async () => {
    const provider = createTikTokProviderForAccount(params);
    if (!provider) {
      return {
        available: false,
        needsReconnect: true,
        reason:
          'Your stored TikTok connection could not be used. Please reconnect your TikTok account.',
        requiredScope: 'video.list',
        videos: [],
      };
    }
    return provider.getVideos(limit);
  });
}
