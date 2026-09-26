import type { TikTokProfileView, TikTokUnavailableField, TikTokVideosView } from '@cluecrew/shared';
import type { TikTokConfig } from '../../config.js';
import { obtainAccessToken } from '../../auth/accessToken.js';
import {
  ProviderAuthError,
  ProviderNotConnectedError,
  UnsupportedCapabilityError,
  type ContentItem,
  type ProviderCapabilities,
  type ProviderIdentity,
  type SocialProvider,
} from '../types.js';
import { fetchUserInfo, fetchUserVideos, USER_INFO_FIELDS, revokeAccessToken } from './tiktokApi.js';

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
  /** Maps provider CDN URLs through the signed media proxy (optional). */
  mapMediaUrl?: (url: string | null) => string | null;
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

  private async fetchUserInfoWithToken(fields: readonly string[]) {
    const token = await this.ensureAccessToken();
    return fetchUserInfo(token, fields);
  }

  /**
   * Real Display API profile for the account page. Fields are only requested
   * when the matching scope was granted; everything else is reported as
   * unavailable with the exact TikTok permission that would be required.
   */
  async getProfile(): Promise<TikTokProfileView> {
    const requested = this.options.config.scopes;
    const granted = this.scopes;
    const missing = requested.filter((scope) => !granted.includes(scope));
    const unavailable: TikTokUnavailableField[] = [];
    const fields: string[] = [...USER_INFO_FIELDS.basic];

    const hasProfileScope = granted.includes('user.info.profile');
    const hasStatsScope = granted.includes('user.info.stats');
    if (hasProfileScope) {
      fields.push(...USER_INFO_FIELDS.profile);
    } else {
      unavailable.push({
        field: 'profile',
        reason:
          'TikTok requires the user.info.profile permission for username, bio and the profile link.',
        requiredScope: 'user.info.profile',
      });
    }
    if (hasStatsScope) {
      fields.push(...USER_INFO_FIELDS.stats);
    } else {
      unavailable.push({
        field: 'stats',
        reason:
          'TikTok requires the user.info.stats permission for follower counts and video statistics.',
        requiredScope: 'user.info.stats',
      });
    }

    const base: TikTokProfileView = {
      connected: true,
      needsReconnect: false,
      openId: this.options.providerUserId,
      displayName: this.options.displayName,
      avatarUrl: this.options.avatarUrl,
      username: null,
      bioDescription: null,
      profileDeepLink: null,
      isVerified: null,
      stats: null,
      scopesRequested: requested,
      scopesGranted: granted,
      scopesMissing: missing,
      unavailable,
      connectedAt: null,
      accessTokenExpiresAt: this.accessTokenExpiresAt
        ? new Date(this.accessTokenExpiresAt).toISOString()
        : null,
      message: null,
    };

    try {
      const info = await this.fetchUserInfoWithToken(fields);
      const statsAvailable =
        hasStatsScope &&
        [info.follower_count, info.following_count, info.likes_count, info.video_count].some(
          (value) => value !== undefined,
        );
      return {
        ...base,
        openId: info.open_id ?? base.openId,
        displayName: info.display_name ?? base.displayName,
        avatarUrl:
          info.avatar_url ?? info.avatar_large_url ?? info.avatar_url_100 ?? base.avatarUrl,
        username: info.username ?? null,
        bioDescription: info.bio_description ?? null,
        profileDeepLink: info.profile_deep_link ?? null,
        isVerified: typeof info.is_verified === 'boolean' ? info.is_verified : null,
        stats: statsAvailable
          ? {
              followerCount: Number(info.follower_count ?? 0),
              followingCount: Number(info.following_count ?? 0),
              likesCount: Number(info.likes_count ?? 0),
              videoCount: Number(info.video_count ?? 0),
            }
          : null,
      };
    } catch (error) {
      if (error instanceof ProviderAuthError) {
        const detail = error.message?.trim();
        return {
          ...base,
          needsReconnect: true,
          message: detail
            ? `${detail} — reconnect your TikTok account to continue.`
            : 'Reconnect your TikTok account to continue.',
        };
      }
      throw error;
    }
  }

  /**
   * The connected account's own public videos (video.list scope), including
   * the statistics TikTok returns for them. Never invents numbers: missing
   * fields stay null and the response explains what permission is required.
   */
  async getVideos(limit = 20): Promise<TikTokVideosView> {
    if (!this.hasScope('video.list')) {
      return {
        available: false,
        needsReconnect: false,
        reason:
          'TikTok requires the video.list permission to read your public videos. Reconnect and accept that permission.',
        requiredScope: 'video.list',
        videos: [],
      };
    }
    try {
      const token = await this.ensureAccessToken();
      const raw = await fetchUserVideos({ accessToken: token, limit });
      const mapUrl = this.options.mapMediaUrl;
      return {
        available: true,
        needsReconnect: false,
        reason: null,
        requiredScope: 'video.list',
        videos: raw.map((video) => ({
          id: video.id,
          title: video.title ?? null,
          description: video.video_description ?? null,
          coverUrl: video.cover_image_url
            ? (mapUrl ? mapUrl(video.cover_image_url) : video.cover_image_url)
            : null,
          shareUrl: video.share_url ?? video.embed_link ?? null,
          durationSeconds: typeof video.duration === 'number' ? video.duration : null,
          viewCount: typeof video.view_count === 'number' ? video.view_count : null,
          likeCount: typeof video.like_count === 'number' ? video.like_count : null,
          commentCount: typeof video.comment_count === 'number' ? video.comment_count : null,
          shareCount: typeof video.share_count === 'number' ? video.share_count : null,
          createdAt: video.create_time ? video.create_time * 1000 : null,
        })),
      };
    } catch (error) {
      if (error instanceof ProviderAuthError) {
        const detail = error.message?.trim();
        return {
          available: false,
          needsReconnect: true,
          reason: detail
            ? `${detail} — reconnect your TikTok account to continue.`
            : 'Reconnect your TikTok account to continue.',
          requiredScope: 'video.list',
          videos: [],
        };
      }
      throw error;
    }
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
