import { AppError } from '../lib/errors.js';
import type { ActionKind, ContentSource } from '@cluecrew/shared';

/** Minimal, display-ready content reference. No bulk provider payloads are kept. */
export interface ContentItem {
  provider: ContentSource;
  kind: ActionKind;
  contentId: string;
  title: string | null;
  coverUrl: string | null;
  webUrl: string | null;
  authorName: string | null;
  createdAt: number | null;
}

export interface ProviderCapability {
  available: boolean;
  reason: string;
  /** Official TikTok scope that would be needed. */
  scope?: string;
}

export interface ProviderCapabilities {
  like: ProviderCapability;
  repost: ProviderCapability;
  save: ProviderCapability;
  post: ProviderCapability;
}

export interface ProviderIdentity {
  providerUserId: string;
  displayName: string;
  avatarUrl: string | null;
  scopes: string[];
}

/**
 * Provider contract the game engine talks to.
 *
 * Implementing a new social network only requires implementing this interface
 * and registering it in the provider factory — the engine, modes, scoring,
 * lobby and UI are provider-agnostic.
 */
export interface SocialProvider {
  readonly source: ContentSource;
  /** Human readable label shown in the lobby ("Demo data", "TikTok", ...). */
  readonly label: string;
  isConnected(): boolean;
  /** Verifies/refreshes the connection and returns the profile. */
  authenticate(): Promise<ProviderIdentity>;
  getUser(): Promise<ProviderIdentity | null>;
  getCapabilities(): ProviderCapabilities;
  getAvailableLikedContent(limit: number): Promise<ContentItem[]>;
  getAvailableRepostedContent(limit: number): Promise<ContentItem[]>;
  getAvailableSavedContent(limit: number): Promise<ContentItem[]>;
  getAvailablePostedContent(limit: number): Promise<ContentItem[]>;
  disconnect(): Promise<void>;
}

export class ProviderNotConnectedError extends AppError {
  constructor() {
    super('TIKTOK_AUTH_FAILED', {
      message: 'This player has not connected a TikTok account.',
      status: 401,
    });
    this.name = 'ProviderNotConnectedError';
  }
}

export class ProviderAuthError extends AppError {
  constructor(message = 'TikTok rejected the stored authorization. Please reconnect your account.') {
    super('TIKTOK_AUTH_FAILED', { message, status: 401 });
    this.name = 'ProviderAuthError';
  }
}

export class ProviderRateLimitError extends AppError {
  constructor(message = 'TikTok is rate limiting us right now. Please try again shortly.') {
    super('TIKTOK_RATE_LIMITED', { message, status: 429 });
    this.name = 'ProviderRateLimitError';
  }
}

export class ProviderApiError extends AppError {
  constructor(message = 'TikTok returned an unexpected error.') {
    super('TIKTOK_API_ERROR', { message, status: 502 });
    this.name = 'ProviderApiError';
  }
}

export class ProviderScopeMissingError extends AppError {
  constructor(scope: string) {
    super('OAUTH_SCOPE_MISSING', {
      message: `The TikTok account did not grant the "${scope}" permission required for this mode.`,
      status: 403,
    });
    this.name = 'ProviderScopeMissingError';
  }
}

/** Thrown when a mode is not supported by the provider at all (e.g. TikTok likes). */
export class UnsupportedCapabilityError extends AppError {
  constructor(message: string) {
    super('CONTENT_UNAVAILABLE', { message, status: 501 });
    this.name = 'UnsupportedCapabilityError';
  }
}
