import type { ActionKind } from '@cluecrew/shared';
import {
  UnsupportedCapabilityError,
  type ContentItem,
  type ProviderCapabilities,
  type ProviderIdentity,
  type SocialProvider,
} from '../types.js';
import { generateMockItems } from './mockData.js';

const ITEMS_PER_KIND = 60;

const MODE_REASON: Record<ActionKind, string> = {
  like: 'Demo data. TikTok\u2019s official API does not expose liked videos to consumer apps (only research access).',
  repost:
    'Demo data. TikTok\u2019s official API does not expose reposts (research access only).',
  save: 'Demo data. TikTok\u2019s official API does not expose saved/favourite videos (EEA/UK data portability only).',
  post: 'Demo data. Connect TikTok with the video.list permission for real posts.',
};

export interface MockSocialProviderOptions {
  playerKey: string;
  displayName: string;
  avatarSeed: number;
  enabled: boolean;
  /** Reason shown when disabled by server policy. */
  disabledReason?: string;
}

/**
 * Fully working provider that generates realistic, clearly-labelled demo data.
 * Used for local testing, demos and every mode the official TikTok API does
 * not expose. It is never presented as real TikTok data.
 */
export class MockSocialProvider implements SocialProvider {
  readonly source = 'mock' as const;
  readonly label = 'Demo data';
  private readonly options: MockSocialProviderOptions;

  constructor(options: MockSocialProviderOptions) {
    this.options = options;
  }

  isConnected(): boolean {
    return this.options.enabled;
  }

  async authenticate(): Promise<ProviderIdentity> {
    return {
      providerUserId: `mock:${this.options.playerKey}`,
      displayName: this.options.displayName,
      avatarUrl: null,
      scopes: [],
    };
  }

  async getUser(): Promise<ProviderIdentity> {
    return this.authenticate();
  }

  getCapabilities(): ProviderCapabilities {
    if (!this.options.enabled) {
      const reason =
        this.options.disabledReason ??
        'Demo data is disabled on this server. Connect a TikTok account to supply real content.';
      const blocked = { available: false, reason };
      return { like: blocked, repost: blocked, save: blocked, post: blocked };
    }
    return {
      like: { available: true, reason: MODE_REASON.like },
      repost: { available: true, reason: MODE_REASON.repost },
      save: { available: true, reason: MODE_REASON.save },
      post: { available: true, reason: MODE_REASON.post },
    };
  }

  private build(kind: ActionKind, limit: number): ContentItem[] {
    if (!this.options.enabled) {
      throw new UnsupportedCapabilityError(
        this.options.disabledReason ??
          'Demo data is disabled on this server. Connect a TikTok account to supply real content.',
      );
    }
    return generateMockItems(
      this.options.playerKey,
      kind,
      Math.min(limit, ITEMS_PER_KIND),
      Date.now(),
    ).map((item) => ({
      provider: 'mock' as const,
      kind,
      contentId: item.contentId,
      title: item.title,
      coverUrl: item.coverUrl,
      webUrl: null,
      authorName: item.authorName,
      createdAt: item.createdAt,
    }));
  }

  async getAvailableLikedContent(limit: number): Promise<ContentItem[]> {
    return this.build('like', limit);
  }

  async getAvailableRepostedContent(limit: number): Promise<ContentItem[]> {
    return this.build('repost', limit);
  }

  async getAvailableSavedContent(limit: number): Promise<ContentItem[]> {
    return this.build('save', limit);
  }

  async getAvailablePostedContent(limit: number): Promise<ContentItem[]> {
    return this.build('post', limit);
  }

  async disconnect(): Promise<void> {
    // Nothing to revoke for demo data.
  }
}
