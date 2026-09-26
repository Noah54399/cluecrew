import type { ActivityImportState } from '@cluecrew/shared';
import type { SocialActionRow } from '../../database/repositories.js';
import {
  UnsupportedCapabilityError,
  type ContentItem,
  type ProviderCapabilities,
  type ProviderIdentity,
  type SocialProvider,
} from '../types.js';

const REPOST_REASON =
  'TikTok does not document a reposts section in its Data Portability exports, so real repost data is unavailable.';

export interface TikTokDataPortabilityProviderOptions {
  providerUserId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Public import state, used to explain capabilities honestly. */
  importState: ActivityImportState;
  /** Normalized actions that were actually imported (like/save/repost). */
  actions: SocialActionRow[];
  /** Display-API delegate for the player's own public videos (video.list). */
  displayProvider: SocialProvider | null;
}

/**
 * Serves real TikTok content that came from an official Data Portability
 * export. Only actions that were genuinely present in the export are exposed —
 * currently "Like List" (likes) and "Favourite Videos" (saves).
 */
export class TikTokDataPortabilityProvider implements SocialProvider {
  readonly source = 'tiktok' as const;
  readonly label = 'TikTok';
  private readonly options: TikTokDataPortabilityProviderOptions;
  private readonly byKind: Record<'like' | 'save' | 'repost', SocialActionRow[]> = {
    like: [],
    save: [],
    repost: [],
  };

  constructor(options: TikTokDataPortabilityProviderOptions) {
    this.options = options;
    for (const action of options.actions) {
      if (action.kind === 'like' || action.kind === 'save' || action.kind === 'repost') {
        this.byKind[action.kind].push(action);
      }
    }
  }

  isConnected(): boolean {
    return true;
  }

  async authenticate(): Promise<ProviderIdentity> {
    const identity = await this.getUser();
    if (identity) return identity;
    return {
      providerUserId: this.options.providerUserId,
      displayName: this.options.displayName,
      avatarUrl: this.options.avatarUrl,
      scopes: [],
    };
  }

  async getUser(): Promise<ProviderIdentity | null> {
    if (this.options.displayProvider) {
      try {
        const identity = await this.options.displayProvider.getUser();
        if (identity) return identity;
      } catch {
        // The Display API may be unavailable while imported data still works.
      }
    }
    return {
      providerUserId: this.options.providerUserId,
      displayName: this.options.displayName,
      avatarUrl: this.options.avatarUrl,
      scopes: [],
    };
  }

  private importedReason(kind: 'like' | 'save'): string {
    const state = this.options.importState;
    if (!state.enabled) {
      return 'TikTok activity import is currently unavailable for this application (Data Portability approval required).';
    }
    if (!state.scopeGranted) {
      return 'This TikTok account has not granted the data portability permission yet.';
    }
    switch (state.status) {
      case 'requesting':
      case 'pending':
        return 'TikTok is still preparing your data export. This mode becomes available once the import finishes.';
      case 'importing':
        return 'Your TikTok activity is being imported right now.';
      case 'failed':
        return state.error?.message ?? 'The last TikTok activity import failed. Try again in the lobby.';
      case 'expired':
        return 'The prepared TikTok export expired before import. Request a new export in the lobby.';
      case 'ready':
        return kind === 'like'
          ? 'Your export contains no liked videos that are usable in the game.'
          : 'Your export contains no favourite/saved videos that are usable in the game.';
      default:
        return 'No TikTok activity import yet. Start one from the lobby.';
    }
  }

  getCapabilities(): ProviderCapabilities {
    const likeCount = this.byKind.like.length;
    const saveCount = this.byKind.save.length;
    const repostCount = this.byKind.repost.length;
    const displayCapabilities = this.options.displayProvider?.getCapabilities() ?? null;

    return {
      like:
        likeCount > 0
          ? {
              available: true,
              reason: `Imported ${likeCount} liked ${likeCount === 1 ? 'video' : 'videos'} from your official TikTok Data Portability export.`,
            }
          : { available: false, reason: this.importedReason('like'), scope: 'portability.all.ongoing' },
      save:
        saveCount > 0
          ? {
              available: true,
              reason: `Imported ${saveCount} favourite ${saveCount === 1 ? 'video' : 'videos'} from your official TikTok Data Portability export.`,
            }
          : { available: false, reason: this.importedReason('save'), scope: 'portability.all.ongoing' },
      repost:
        repostCount > 0
          ? {
              available: true,
              reason: `Imported ${repostCount} reposted ${repostCount === 1 ? 'video' : 'videos'} from your TikTok export.`,
            }
          : { available: false, reason: REPOST_REASON },
      post: displayCapabilities
        ? displayCapabilities.post
        : {
            available: false,
            reason:
              'Reconnect TikTok with the video.list permission to share your own public videos.',
            scope: 'video.list',
          },
    };
  }

  private toItems(kind: 'like' | 'save' | 'repost', limit: number): ContentItem[] {
    return this.byKind[kind].slice(0, limit).map((action) => ({
      provider: 'tiktok' as const,
      kind,
      contentId: action.contentId,
      title: action.title,
      coverUrl: action.coverUrl,
      webUrl: action.contentUrl,
      authorName: action.authorName,
      createdAt: action.occurredAt ? Date.parse(action.occurredAt) : null,
    }));
  }

  async getAvailableLikedContent(limit: number): Promise<ContentItem[]> {
    if (this.byKind.like.length === 0) {
      throw new UnsupportedCapabilityError(this.importedReason('like'));
    }
    return this.toItems('like', limit);
  }

  async getAvailableSavedContent(limit: number): Promise<ContentItem[]> {
    if (this.byKind.save.length === 0) {
      throw new UnsupportedCapabilityError(this.importedReason('save'));
    }
    return this.toItems('save', limit);
  }

  async getAvailableRepostedContent(limit: number): Promise<ContentItem[]> {
    if (this.byKind.repost.length === 0) {
      throw new UnsupportedCapabilityError(REPOST_REASON);
    }
    return this.toItems('repost', limit);
  }

  async getAvailablePostedContent(limit: number): Promise<ContentItem[]> {
    if (!this.options.displayProvider) {
      throw new UnsupportedCapabilityError(
        'Reconnect TikTok with the video.list permission to share your own public videos.',
      );
    }
    return this.options.displayProvider.getAvailablePostedContent(limit);
  }

  async disconnect(): Promise<void> {
    await this.options.displayProvider?.disconnect();
  }
}
