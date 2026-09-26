import type { TikTokConfig } from '../config.js';
import { ProviderAuthError, ProviderNotConnectedError } from '../providers/types.js';
import { refreshAccessToken } from '../providers/tiktok/tiktokApi.js';

export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number | null;
  scopes: string[];
}

export interface ObtainAccessTokenParams {
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: number | null;
  refreshTokenExpiresAt: number | null;
  scopes: string[];
  config: TikTokConfig;
  now?: () => number;
}

export interface ObtainAccessTokenResult {
  accessToken: string;
  /** Set when a refresh happened, so callers can persist the rotated tokens. */
  refreshed: RefreshedTokens | null;
}

const EXPIRY_MARGIN_MS = 60_000;

/**
 * Returns a usable TikTok access token, refreshing it when necessary.
 * Shared by TikTokProvider (Display API) and the Data Portability client.
 */
export async function obtainAccessToken(
  params: ObtainAccessTokenParams,
): Promise<ObtainAccessTokenResult> {
  const now = (params.now ?? Date.now)();

  if (
    params.accessToken &&
    params.accessTokenExpiresAt &&
    params.accessTokenExpiresAt - EXPIRY_MARGIN_MS > now
  ) {
    return { accessToken: params.accessToken, refreshed: null };
  }

  if (!params.accessToken && !params.refreshToken) {
    throw new ProviderNotConnectedError();
  }
  if (!params.refreshToken) {
    throw new ProviderAuthError('The TikTok session expired. Please reconnect your account.');
  }
  if (params.refreshTokenExpiresAt && params.refreshTokenExpiresAt < now) {
    throw new ProviderAuthError('The TikTok connection expired. Please reconnect your account.');
  }

  const refreshed = await refreshAccessToken({
    clientKey: params.config.clientKey,
    clientSecret: params.config.clientSecret,
    refreshToken: params.refreshToken,
  });

  const scopes = refreshed.scope
    ? refreshed.scope
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean)
    : params.scopes;

  return {
    accessToken: refreshed.access_token,
    refreshed: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? params.refreshToken,
      accessTokenExpiresAt: now + refreshed.expires_in * 1000,
      refreshTokenExpiresAt:
        refreshed.refresh_expires_in !== undefined
          ? now + refreshed.refresh_expires_in * 1000
          : params.refreshTokenExpiresAt,
      scopes,
    },
  };
}
