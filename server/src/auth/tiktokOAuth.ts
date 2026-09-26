import type { ServerConfig } from '../config.js';
import type { OauthAccountRow, Repositories } from '../database/repositories.js';
import { encryptString } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { appEvents } from '../lib/events.js';
import { randomId, randomSecretToken } from '../lib/ids.js';
import {
  exchangeAuthorizationCode,
  fetchUserInfo,
  revokeAccessToken,
} from '../providers/tiktok/tiktokApi.js';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.length > 200) return '/';
  return trimmed;
}

export interface LinkedAccountSummary {
  linked: boolean;
  providerUserId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  scopes: string[];
  /** Which game actions this connection can actually supply. */
  canSupply: Record<string, boolean>;
  connectedAt: string | null;
}

export interface TikTokOAuthHooks {
  /** Called after a successful authorization (start a data import if granted). */
  onLinked?: (userId: string) => void;
  /** Called after disconnect (delete imported activity data). */
  onDisconnect?: (userId: string) => void;
}

export class TikTokOAuthService {
  constructor(
    private readonly config: ServerConfig,
    private readonly repos: Repositories,
    private readonly hooks: TikTokOAuthHooks = {},
  ) {}

  isConfigured(): boolean {
    return this.config.tiktok.configured;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new AppError('TIKTOK_NOT_CONFIGURED', {
        message:
          'TikTok sign-in is not configured on this server. Add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to enable it.',
        status: 503,
      });
    }
  }

  /** Builds the TikTok authorization URL and stores a one-time CSRF state token. */
  createAuthorizeUrl(params: { userId: string; returnTo?: unknown }): string {
    this.assertConfigured();
    const state = randomSecretToken();
    const now = new Date();
    this.repos.oauthStates.create({
      id: state,
      userId: params.userId,
      returnTo: sanitizeReturnTo(params.returnTo),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS).toISOString(),
    });

    const query = new URLSearchParams({
      client_key: this.config.tiktok.clientKey,
      response_type: 'code',
      scope: this.config.tiktok.scopes.join(','),
      redirect_uri: this.config.tiktok.redirectUri,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${query.toString()}`;
  }

  /**
   * Handles the OAuth callback: validates the one-time state (CSRF), exchanges the
   * code, stores the encrypted tokens and notifies the rest of the app.
   */
  async handleCallback(params: {
    code?: unknown;
    state?: unknown;
    error?: unknown;
    errorDescription?: unknown;
  }): Promise<{ returnTo: string; userId: string }> {
    this.assertConfigured();

    const state = typeof params.state === 'string' ? params.state : '';
    if (!state) throw new AppError('TIKTOK_STATE_INVALID');

    const stateRow = this.repos.oauthStates.consume(state, new Date().toISOString());
    if (!stateRow) throw new AppError('TIKTOK_STATE_INVALID');

    if (params.error) {
      throw new AppError('TIKTOK_AUTH_FAILED', {
        message:
          typeof params.errorDescription === 'string' && params.errorDescription.length > 0
            ? params.errorDescription
            : 'TikTok authorization was cancelled or refused.',
      });
    }

    const code = typeof params.code === 'string' ? params.code : '';
    if (!code) throw new AppError('TIKTOK_AUTH_FAILED');

    const tokens = await exchangeAuthorizationCode({
      clientKey: this.config.tiktok.clientKey,
      clientSecret: this.config.tiktok.clientSecret,
      code,
      redirectUri: this.config.tiktok.redirectUri,
    });

    const scopes = tokens.scope
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);

    if (!scopes.includes('user.info.basic')) {
      throw new AppError('OAUTH_SCOPE_MISSING', {
        message: 'The TikTok authorization did not include the user.info.basic permission.',
      });
    }

    let displayName: string | null = null;
    let avatarUrl: string | null = null;
    try {
      const userInfo = await fetchUserInfo(tokens.access_token);
      displayName = userInfo.display_name ?? null;
      avatarUrl = userInfo.avatar_url ?? null;
    } catch {
      // Profile enrichment is optional — the link itself is valid.
    }

    const now = Date.now();
    this.repos.oauthAccounts.save({
      id: randomId('oa'),
      userId: stateRow.userId,
      provider: 'tiktok',
      providerUserId: tokens.open_id,
      displayName,
      avatarUrl,
      accessTokenEnc: encryptString(tokens.access_token, this.config.tokenEncryptionKey),
      refreshTokenEnc: encryptString(tokens.refresh_token, this.config.tokenEncryptionKey),
      accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000).toISOString(),
      refreshTokenExpiresAt:
        tokens.refresh_expires_in !== undefined
          ? new Date(now + tokens.refresh_expires_in * 1000).toISOString()
          : null,
      scopes: scopes.join(','),
      capabilitiesJson: JSON.stringify({
        post: scopes.includes('video.list'),
        note: 'likes/reposts/saves are not exposed by TikTok\u2019s official API for consumer apps',
      }),
      now: new Date(now).toISOString(),
    });

    appEvents.emit('tiktok:linked', { userId: stateRow.userId });

    // Adopt the TikTok display name when the user never picked one themselves
    // (e.g. they clicked "Connect TikTok" before joining a room).
    try {
      const user = this.repos.users.get(stateRow.userId);
      if (user && displayName && (user.displayName === 'TikTok user' || user.displayName.trim() === '')) {
        this.repos.users.update(user.id, { displayName, now: new Date().toISOString() });
      }
    } catch {
      // Non-fatal.
    }

    // If a Data Portability scope was granted, kick off the (asynchronous)
    // activity export immediately. The lobby shows the honest progress state.
    try {
      this.hooks.onLinked?.(stateRow.userId);
    } catch {
      // Never fail the OAuth callback because of an import hiccup.
    }
    return { returnTo: stateRow.returnTo ?? '/', userId: stateRow.userId };
  }

  getLinkedAccount(userId: string): LinkedAccountSummary {
    const account = this.repos.oauthAccounts.getForUser(userId, 'tiktok');
    if (!account) {
      return {
        linked: false,
        providerUserId: null,
        displayName: null,
        avatarUrl: null,
        scopes: [],
        canSupply: { like: false, repost: false, save: false, post: false },
        connectedAt: null,
      };
    }
    const scopes = account.scopes.split(',').map((scope) => scope.trim()).filter(Boolean);
    return {
      linked: true,
      providerUserId: account.providerUserId,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      scopes,
      canSupply: {
        like: false,
        repost: false,
        save: false,
        post: scopes.includes('video.list'),
      },
      connectedAt: account.connectedAt,
    };
  }

  /** Revokes the token with TikTok (best effort) and deletes it from our database. */
  async disconnect(userId: string): Promise<void> {
    const account: OauthAccountRow | null = this.repos.oauthAccounts.getForUser(userId, 'tiktok');
    if (account) {
      if (this.isConfigured() && account.accessTokenEnc) {
        try {
          const { decryptString } = await import('../lib/crypto.js');
          const accessToken = decryptString(account.accessTokenEnc, this.config.tokenEncryptionKey);
          await revokeAccessToken({
            clientKey: this.config.tiktok.clientKey,
            clientSecret: this.config.tiktok.clientSecret,
            accessToken,
          });
        } catch {
          // Ignore revocation failures — local deletion is what matters for privacy.
        }
      }
      this.repos.oauthAccounts.deleteForUser(userId, 'tiktok');
    }
    // Privacy: disconnecting always removes imported activity data.
    try {
      this.hooks.onDisconnect?.(userId);
    } catch {
      // Non-fatal.
    }
    appEvents.emit('tiktok:unlinked', { userId });
  }
}
