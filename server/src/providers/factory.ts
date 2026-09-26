import type { ActivityImportState } from '@cluecrew/shared';
import type { ServerConfig } from '../config.js';
import { decryptString } from '../lib/crypto.js';
import { buildProxiedMediaUrl } from '../lib/mediaProxy.js';
import type { OauthAccountRow, SocialActionRow } from '../database/repositories.js';
import { CONNECT_PROMPT, DisconnectedSocialProvider } from './DisconnectedSocialProvider.js';
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

/**
 * Injectable so tests can substitute a deterministic provider double.
 * Production always uses `createSocialProvider` (real TikTok data only).
 */
export type SocialProviderFactory = (params: CreateProviderParams) => SocialProvider;

function buildDisplayProvider(params: {
  account: OauthAccountRow;
  config: ServerConfig;
  onTokensRefreshed?: CreateProviderParams['onTokensRefreshed'];
}): TikTokProvider | null {
  return createTikTokProviderForAccount(params);
}

/**
 * Builds a TikTokProvider for a stored account (used by the game AND by the
 * account page). Returns null when the stored tokens cannot be decrypted.
 */
export function createTikTokProviderForAccount(params: {
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
      mapMediaUrl: (url) => buildProxiedMediaUrl(url, config),
      onTokensRefreshed: params.onTokensRefreshed,
    });
  } catch {
    return null;
  }
}

/**
 * Chooses the provider for a player. There is no demo provider: a player
 * either has a working TikTok connection (Display API and/or Data Portability
 * import) or contributes no content at all, which the UI shows as an empty
 * state with a "Connect TikTok" prompt.
 *
 * The game engine only ever sees the SocialProvider interface, so adding
 * another network later means implementing it plus one branch here.
 */
export function createSocialProvider(params: CreateProviderParams): SocialProvider {
  const { account, config } = params;

  if (config.tiktok.configured && account && account.provider === 'tiktok') {
    const displayProvider = buildDisplayProvider({
      account,
      config,
      onTokensRefreshed: params.onTokensRefreshed,
    });

    if (params.dataPortability?.state.scopeGranted) {
      // Serve imported likes/saves and delegate own public videos to the Display API.
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

    return new DisconnectedSocialProvider(
      'Your stored TikTok connection could not be used. Please reconnect your TikTok account.',
    );
  }

  return new DisconnectedSocialProvider(
    config.tiktok.configured
      ? CONNECT_PROMPT
      : 'TikTok sign-in is not configured on this server, so real data is unavailable.',
  );
}

export const defaultSocialProviderFactory: SocialProviderFactory = createSocialProvider;

export function resolveProviderSource(account: OauthAccountRow | null): 'tiktok' | 'none' {
  return account?.provider === 'tiktok' ? 'tiktok' : 'none';
}
