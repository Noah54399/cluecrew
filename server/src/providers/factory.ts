import type { ActivityImportState, ContentSourcePreference } from '@cluecrew/shared';
import type { ServerConfig } from '../config.js';
import { decryptString } from '../lib/crypto.js';
import type { OauthAccountRow, SocialActionRow } from '../database/repositories.js';
import { MockSocialProvider } from './mock/MockSocialProvider.js';
import { TikTokDataPortabilityProvider } from './tiktok/TikTokDataPortabilityProvider.js';
import { TikTokProvider } from './tiktok/TikTokProvider.js';
import type { SocialProvider } from './types.js';

export interface ProviderImportData {
  state: ActivityImportState;
  actions: SocialActionRow[];
}

export interface CreateProviderParams {
  playerKey: string;
  playerName: string;
  avatarSeed: number;
  account: OauthAccountRow | null;
  config: ServerConfig;
  /** Player's content source preference (default: auto). */
  preference?: ContentSourcePreference;
  /** Imported TikTok activity, when the player granted a portability scope. */
  dataPortability?: ProviderImportData | null;
  onTokensRefreshed?: (tokens: {
    accessToken: string;
    refreshToken: string | null;
    accessTokenExpiresAt: number;
    refreshTokenExpiresAt: number | null;
    scopes: string[];
  }) => void;
}

function buildDisplayProvider(params: {
  account: OauthAccountRow;
  config: ServerConfig;
  onTokensRefreshed?: CreateProviderParams['onTokensRefreshed'];
}): TikTokProvider | null {
  const { account, config } = params;
  try {
    const accessToken = account.accessTokenEnc
      ? decryptString(account.accessTokenEnc, config.tokenEncryptionKey)
      : null;
    const refreshToken = account.refreshTokenEnc
      ? decryptString(account.refreshTokenEnc, config.tokenEncryptionKey)
      : null;
    if (!accessToken && !refreshToken) return null;
    return new TikTokProvider({
      providerUserId: account.providerUserId,
      displayName: account.displayName ?? 'TikTok user',
      avatarUrl: account.avatarUrl,
      scopes: account.scopes.split(',').map((scope) => scope.trim()).filter(Boolean),
      accessToken,
      refreshToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt
        ? Date.parse(account.accessTokenExpiresAt)
        : null,
      refreshTokenExpiresAt: account.refreshTokenExpiresAt
        ? Date.parse(account.refreshTokenExpiresAt)
        : null,
      config: config.tiktok,
      onTokensRefreshed: params.onTokensRefreshed,
    });
  } catch {
    return null;
  }
}

function buildMock(
  params: CreateProviderParams,
  enabled: boolean,
  disabledReason: string,
): SocialProvider {
  return new MockSocialProvider({
    playerKey: params.playerKey,
    displayName: params.playerName,
    avatarSeed: params.avatarSeed,
    enabled,
    disabledReason,
  });
}

/**
 * Chooses the right provider for a player.
 *
 *  - preference "mock": always clearly-labelled demo data (dev/demo switch)
 *  - preference "real": real TikTok only; without a connection nothing is faked
 *  - preference "auto" (default): real TikTok when a usable connection exists
 *    (Data Portability import or Display API), otherwise demo data
 *
 * The game engine only ever sees the SocialProvider interface, so adding
 * another network later means adding one branch here plus an implementation.
 */
export function createSocialProvider(params: CreateProviderParams): SocialProvider {
  const { account, config } = params;
  const preference = params.preference ?? 'auto';

  // The explicit development switch always wins: demo data on demand.
  if (preference === 'mock') {
    return buildMock(
      params,
      config.allowMockProvider,
      'Demo data is disabled on this server. Connect a TikTok account to supply real content.',
    );
  }

  if (config.tiktok.configured && account && account.provider === 'tiktok') {
    const displayProvider = buildDisplayProvider({
      account,
      config,
      onTokensRefreshed: params.onTokensRefreshed,
    });

    if (params.dataPortability?.state.scopeGranted) {
      // The player granted a Data Portability scope: serve imported real data
      // (likes/saves) and delegate own public videos to the Display API.
      return new TikTokDataPortabilityProvider({
        providerUserId: account.providerUserId,
        displayName: account.displayName ?? params.playerName,
        avatarUrl: account.avatarUrl,
        importState: params.dataPortability.state,
        actions: params.dataPortability.actions,
        displayProvider,
      });
    }

    if (displayProvider) {
      return displayProvider;
    }
  }

  if (preference === 'real') {
    return buildMock(
      params,
      false,
      'Real TikTok data is selected, but no TikTok account is connected for this player.',
    );
  }

  return buildMock(
    params,
    config.allowMockProvider,
    'Demo data is disabled on this server. Connect a TikTok account to supply real content.',
  );
}

export function resolveProviderSource(account: OauthAccountRow | null): 'tiktok' | 'mock' {
  return account?.provider === 'tiktok' ? 'tiktok' : 'mock';
}
