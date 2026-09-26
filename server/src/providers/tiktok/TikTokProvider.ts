import type { TikTokConfig } from '../../config.js';
import { obtainAccessToken } from '../../auth/accessToken.js';
import {
  ProviderNotConnectedError,
  UnsupportedCapabilityError,
  type ContentItem,
  type ProviderCapabilities,
  type ProviderIdentity,
  type SocialProvider,
} from '../types.js';
import { fetchUserInfo, fetchUserVideos, revokeAccessToken } from './tiktokApi.js';

export interface TikTokProviderOptions {
  providerUserId: string;
  displayName: string;
  avatarUrl: string | null;
  scopes: string[];
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: number | null;
  refreshTokenExpiresAt: number | null;
  config: TikTokConfig;
  onTokensRefreshed?: (tokens: {
    accessToken: string;
    refreshToken: string | null;
    accessTokenExpiresAt: number;
    refreshTokenExpiresAt: number | null;
    scopes: string[];
  }) => void;
}

const LIKE_REASON =
  'TikTok does not expose liked videos through its official API for consumer apps.';
const REPOST_REASON =
  'TikTok does not expose reposted videos through its official API (research access only).';
const SAVE_REASON =
  'TikTok does not expose saved or favourite videos through its official API (EEA/UK data portability only).';

/**
 * Real TikTok integration (Login Kit OAuth v2 + Display API).
 *
 * Honest capability map — verified against the official docs in Sept 2026:
 *  - post  (the user's own public videos): SUPPORTED with the `video.list` scope
 *  - like  / repost / save: NOT available to consumer apps; those methods throw
 *    UnsupportedCapabilityError instead of faking data.
 */
export class TikTokProvider implements SocialProvider {
  readonly source = 'tiktok' as const;
  readonly label = 'TikTok';

  private accessToken: string | null;
  private refreshToken: string | null;
  private accessTokenExpiresAt: number | null;
  private refreshTokenExpiresAt: number | null;
  private scopes: string[];
  private readonly options: TikTokProviderOptions;

  constructor(options: TikTokProviderOptions) {
    this.options = options;
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.accessTokenExpiresAt = options.accessTokenExpiresAt;
    this.refreshTokenExpiresAt = options.refreshTokenExpiresAt;
    this.scopes = options.scopes;
  }

  isConnected(): boolean {
    return Boolean(this.accessToken || this.refreshToken);
  }

  private hasScope(scope: string): boolean {
    return this.scopes.includes(scope);
  }

  private async ensureAccessToken(): Promise<string> {
    const result = await obtainAccessToken({
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      accessTokenExpiresAt: this.accessTokenExpiresAt,
      refreshTokenExpiresAt: this.refreshTokenExpiresAt,
      scopes: this.scopes,
      config: this.options.config,
    });

    if (result.refreshed) {
      const refreshed = result.refreshed;
      this.accessToken = refreshed.accessToken;
      this.refreshToken = refreshed.refreshToken;
      this.accessTokenExpiresAt = refreshed.accessTokenExpiresAt;
      this.refreshTokenExpiresAt = refreshed.refreshTokenExpiresAt;
      this.scopes = refreshed.scopes;
      this.options.onTokensRefreshed?.({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
        scopes: refreshed.scopes,
      });
    }

    return result.accessToken;
  }

  async authenticate(): Promise<ProviderIdentity> {
    await this.ensureAccessToken();
    const identity = await this.getUser();
    if (!identity) throw new ProviderNotConnectedError();
    return identity;
  }

  async getUser(): Promise<ProviderIdentity | null> {
    if (!this.isConnected()) return null;
    const token = await this.ensureAccessToken();
    const info = await fetchUserInfo(token);
    return {
      providerUserId: info.open_id,
      displayName: info.display_name ?? this.options.displayName,
      avatarUrl: info.avatar_url ?? this.options.avatarUrl,
      scopes: this.scopes,
    };
  }

  getCapabilities(): ProviderCapabilities {
    const postAvailable = this.hasScope('video.list');
    return {
      like: { available: false, reason: LIKE_REASON, scope: 'portability.activity.ongoing' },
      repost: { available: false, reason: REPOST_REASON, scope: 'research.data.basic' },
      save: { available: false, reason: SAVE_REASON, scope: 'portability.activity.ongoing' },
      post: postAvailable
        ? {
            available: true,
            reason: 'Powered by the official TikTok Display API (video.list).',
            scope: 'video.list',
          }
        : {
            available: false,
            reason: 'The TikTok account did not grant the video.list permission required to read public videos.',
            scope: 'video.list',
          },
    };
  }

  private async fetchPostedContent(limit: number): Promise<ContentItem[]> {
    if (!this.hasScope('video.list')) {
      throw new UnsupportedCapabilityError(
        'This TikTok account did not grant the video.list permission. Reconnect and accept the permission to use this mode.',
      );
    }
    const token = await this.ensureAccessToken();
    const videos = await fetchUserVideos({ accessToken: token, limit });
    return videos.map((video) => ({
      provider: 'tiktok' as const,
      kind: 'post' as const,
      contentId: video.id,
      title: video.title ?? video.video_description ?? null,
      coverUrl: video.cover_image_url ?? null,
      webUrl: video.share_url ?? video.embed_link ?? null,
      authorName: this.options.displayName,
      createdAt: video.create_time ? video.create_time * 1000 : null,
    }));
  }

  async getAvailableLikedContent(_limit = 0): Promise<ContentItem[]> {
    throw new UnsupportedCapabilityError(LIKE_REASON);
  }

  async getAvailableRepostedContent(_limit = 0): Promise<ContentItem[]> {
    throw new UnsupportedCapabilityError(REPOST_REASON);
  }

  async getAvailableSavedContent(_limit = 0): Promise<ContentItem[]> {
    throw new UnsupportedCapabilityError(SAVE_REASON);
  }

  async getAvailablePostedContent(limit: number): Promise<ContentItem[]> {
    return this.fetchPostedContent(limit);
  }

  async disconnect(): Promise<void> {
    if (!this.accessToken) return;
    try {
      await revokeAccessToken({
        clientKey: this.options.config.clientKey,
        clientSecret: this.options.config.clientSecret,
        accessToken: this.accessToken,
      });
    } catch {
      // Revocation is best-effort — the stored tokens are deleted regardless.
    }
  }
}
