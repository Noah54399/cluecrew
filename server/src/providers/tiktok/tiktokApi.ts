import {
  ProviderApiError,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderScopeMissingError,
} from '../types.js';

const API_BASE = 'https://open.tiktokapis.com';
const REQUEST_TIMEOUT_MS = 12_000;

export interface TikTokTokenResponse {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
}

export interface TikTokUserInfo {
  open_id: string;
  union_id?: string;
  avatar_url?: string;
  avatar_url_100?: string;
  avatar_large_url?: string;
  display_name?: string;
  /** user.info.profile */
  username?: string;
  bio_description?: string;
  profile_deep_link?: string;
  is_verified?: boolean;
  /** user.info.stats */
  follower_count?: number;
  following_count?: number;
  likes_count?: number;
  video_count?: number;
}

/** Field groups documented per scope for GET /v2/user/info/. */
export const USER_INFO_FIELDS = {
  basic: ['open_id', 'union_id', 'avatar_url', 'display_name'],
  profile: ['username', 'bio_description', 'profile_deep_link', 'is_verified'],
  stats: ['follower_count', 'following_count', 'likes_count', 'video_count'],
} as const;

export interface TikTokVideo {
  id: string;
  title?: string;
  video_description?: string;
  duration?: number;
  cover_image_url?: string;
  share_url?: string;
  embed_link?: string;
  create_time?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
}

interface TikTokApiEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

async function postForm(url: string, form: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (response.status === 429) throw new ProviderRateLimitError();
    if (!response.ok) {
      const errorBody = json as { error_description?: string; error?: string } | null;
      throw new ProviderApiError(
        errorBody?.error_description ??
          `TikTok responded with HTTP ${response.status}${errorBody?.error ? ` (${errorBody.error})` : ''}.`,
      );
    }
    return json;
  } catch (error) {
    if (error instanceof ProviderApiError || error instanceof ProviderRateLimitError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderApiError('TikTok did not respond in time. Please try again.');
    }
    throw new ProviderApiError(
      `Could not reach TikTok: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

function assertOk<T>(envelope: TikTokApiEnvelope<T>, path: string): T {
  const code = envelope.error?.code;
  if (code && code !== 'ok') {
    const message = envelope.error?.message ?? code;
    if (code === 'access_token_invalid' || code === 'invalid_token' || code === 'token_expired') {
      throw new ProviderAuthError('TikTok says the stored authorization is no longer valid. Please reconnect your account.');
    }
    if (code.includes('scope') || code.includes('permission')) {
      throw new ProviderScopeMissingError('video.list');
    }
    if (code.includes('rate') || code.includes('limit')) {
      throw new ProviderRateLimitError();
    }
    throw new ProviderApiError(`TikTok API error on ${path}: ${message}`);
  }
  if (!envelope.data) {
    throw new ProviderApiError(`TikTok API returned no data on ${path}.`);
  }
  return envelope.data;
}

export async function exchangeAuthorizationCode(params: {
  clientKey: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<TikTokTokenResponse> {
  const body = await postForm(`${API_BASE}/v2/oauth/token/`, {
    client_key: params.clientKey,
    client_secret: params.clientSecret,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });
  const record = body as TikTokTokenResponse & { error?: string; error_description?: string };
  if (record.error) {
    throw new ProviderAuthError(record.error_description ?? record.error);
  }
  if (!record.access_token || !record.open_id) {
    throw new ProviderApiError('TikTok token exchange returned an incomplete response.');
  }
  return record;
}

export async function refreshAccessToken(params: {
  clientKey: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TikTokTokenResponse> {
  const body = await postForm(`${API_BASE}/v2/oauth/token/`, {
    client_key: params.clientKey,
    client_secret: params.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  });
  const record = body as TikTokTokenResponse & { error?: string; error_description?: string };
  if (record.error) {
    throw new ProviderAuthError(record.error_description ?? 'TikTok refused to refresh the access token.');
  }
  return record;
}

export async function revokeAccessToken(params: {
  clientKey: string;
  clientSecret: string;
  accessToken: string;
}): Promise<void> {
  await postForm(`${API_BASE}/v2/oauth/revoke/`, {
    client_key: params.clientKey,
    client_secret: params.clientSecret,
    token: params.accessToken,
  });
}

export async function fetchUserInfo(
  accessToken: string,
  fields: readonly string[] = USER_INFO_FIELDS.basic,
): Promise<TikTokUserInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${API_BASE}/v2/user/info/?fields=${fields.join(',')}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (response.status === 429) throw new ProviderRateLimitError();
    const envelope = (await response.json().catch(() => ({}))) as TikTokApiEnvelope<{ user: TikTokUserInfo }>;
    if (!response.ok) {
      const code = (envelope.error?.code ?? '').toLowerCase();
      if (response.status === 401 || code.includes('token')) {
        throw new ProviderAuthError(
          envelope.error?.message && envelope.error.message.length > 0
            ? envelope.error.message
            : 'TikTok rejected the stored authorization. Please reconnect your account.',
        );
      }
      if (code.includes('scope') || code.includes('permission')) {
        throw new ProviderScopeMissingError('video.list');
      }
      throw new ProviderApiError(`TikTok user info failed with HTTP ${response.status}.`);
    }
    const data = assertOk(envelope, '/v2/user/info/');
    return data.user;
  } catch (error) {
    if (
      error instanceof ProviderApiError ||
      error instanceof ProviderRateLimitError ||
      error instanceof ProviderAuthError ||
      error instanceof ProviderScopeMissingError
    ) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderApiError('TikTok did not respond in time. Please try again.');
    }
    throw new ProviderApiError(
      `Could not reach TikTok: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchUserVideos(params: {
  accessToken: string;
  limit: number;
}): Promise<TikTokVideo[]> {
  const maxPerPage = 20;
  const wanted = Math.max(1, Math.min(params.limit, 60));
  const videos: TikTokVideo[] = [];
  let cursor: number | undefined;
  let pages = 0;

  while (videos.length < wanted && pages < 4) {
    pages += 1;
    const query = new URLSearchParams({
      fields:
        'id,title,video_description,duration,cover_image_url,share_url,embed_link,create_time,like_count,comment_count,share_count,view_count',
    });
    const body: Record<string, unknown> = { max_count: Math.min(maxPerPage, wanted - videos.length) };
    if (cursor !== undefined) body.cursor = cursor;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE}/v2/video/list/?${query.toString()}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 429) throw new ProviderRateLimitError();
      const envelope = (await response.json().catch(() => ({}))) as TikTokApiEnvelope<{
        videos: TikTokVideo[];
        cursor: number;
        has_more: boolean;
      }>;
      if (!response.ok) {
        const code = (envelope.error?.code ?? '').toLowerCase();
        if (response.status === 401 || code.includes('token')) {
          throw new ProviderAuthError(
            envelope.error?.message && envelope.error.message.length > 0
              ? envelope.error.message
              : 'TikTok rejected the stored authorization. Please reconnect your account.',
          );
        }
        if (code.includes('scope') || code.includes('permission')) {
          throw new ProviderScopeMissingError('video.list');
        }
        throw new ProviderApiError(`TikTok video list failed with HTTP ${response.status}.`);
      }
      const data = assertOk(envelope, '/v2/video/list/');
      for (const video of data.videos ?? []) {
        videos.push(video);
        if (videos.length >= wanted) break;
      }
      if (!data.has_more) break;
      cursor = data.cursor;
    } catch (error) {
      if (
        error instanceof ProviderApiError ||
        error instanceof ProviderRateLimitError ||
        error instanceof ProviderAuthError ||
        error instanceof ProviderScopeMissingError
      ) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderApiError('TikTok did not respond in time. Please try again.');
      }
      throw new ProviderApiError(
        `Could not reach TikTok: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return videos;
}
