import type { ContentSource } from '@cluecrew/shared';
import {
  ProviderNotConnectedError,
  UnsupportedCapabilityError,
  type ContentItem,
  type ProviderCapabilities,
  type ProviderIdentity,
  type SocialProvider,
} from './types.js';

export const CONNECT_PROMPT = 'Connect your TikTok account to see your real data.';

/**
 * Provider for players without a TikTok connection.
 *
 * It supplies nothing — never fabricated content — and explains exactly what
 * to do. The UI shows this as an empty state ("Connect your TikTok account…").
 */
export class DisconnectedSocialProvider implements SocialProvider {
  readonly source: ContentSource = 'none';
  readonly label = 'Not connected';
  private readonly reason: string;

  constructor(reason: string = CONNECT_PROMPT) {
    this.reason = reason;
  }

  isConnected(): boolean {
    return false;
  }

  async authenticate(): Promise<ProviderIdentity> {
    throw new ProviderNotConnectedError();
  }

  async getUser(): Promise<ProviderIdentity | null> {
    return null;
  }

  getCapabilities(): ProviderCapabilities {
    const unavailable = { available: false, reason: this.reason };
    return { like: unavailable, repost: unavailable, save: unavailable, post: unavailable };
  }

  async getAvailableLikedContent(_limit = 0): Promise<ContentItem[]> {
    throw new UnsupportedCapabilityError(this.reason);
  }

  async getAvailableRepostedContent(_limit = 0): Promise<ContentItem[]> {
    throw new UnsupportedCapabilityError(this.reason);
  }

  async getAvailableSavedContent(_limit = 0): Promise<ContentItem[]> {
    throw new UnsupportedCapabilityError(this.reason);
  }

  async getAvailablePostedContent(_limit = 0): Promise<ContentItem[]> {
    throw new UnsupportedCapabilityError(this.reason);
  }

  async disconnect(): Promise<void> {
    // Nothing to disconnect.
  }
}
