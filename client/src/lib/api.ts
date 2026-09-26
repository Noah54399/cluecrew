import type {
  ActivityImportState,
  CreateRoomResult,
  JoinRoomResult,
  PublicRoomInfo,
  PublicServerConfig,
  TikTokProfileView,
  TikTokVideosView,
} from '@shared';

/**
 * Optional absolute backend URL for split deployments
 * (e.g. Netlify frontend + Render backend). Empty = same origin.
 */
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '')
  .trim()
  .replace(/\/$/, '');

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...init });
  } catch {
    throw new ApiError('NETWORK', 'Network interruption — check your connection and try again.');
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      error?.code ?? 'INTERNAL',
      error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
    );
  }
  return body as T;
}

function jsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  return headers;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'GET' });
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(body ?? {}),
    });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE', headers: jsonHeaders() });
  },
};

export interface SessionPayload {
  user: { id: string; displayName: string; avatarSeed: number } | null;
  csrfToken: string | null;
  tiktok: {
    configured: boolean;
    linked: boolean;
    providerUserId: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    scopes: string[];
    canSupply: Record<string, boolean>;
    connectedAt: string | null;
  };
  import: ActivityImportState;
  server: {
    avatarSeedCount: number;
  };
}

export interface ActivityImportResponse extends ActivityImportState {
  linked: boolean;
}

export const sessionApi = {
  get: () => api.get<SessionPayload>('/api/session'),
  guest: (name: string, avatarSeed: number) =>
    api.post<SessionPayload>('/api/session/guest', { name, avatarSeed }),
  logout: () => api.delete<{ ok: boolean }>('/api/session'),
  deleteMe: () => api.delete<{ ok: boolean }>('/api/me'),
  tiktokStartUrl: (returnTo: string) =>
    api.post<{ url: string }>('/api/auth/tiktok/start-url', { returnTo }),
  tiktokDisconnect: () => api.post<{ ok: boolean }>('/api/auth/tiktok/disconnect'),
};

/** Real TikTok account data (Display API). Nothing here is ever mocked. */
export const tiktokAccountApi = {
  profile: () => api.get<TikTokProfileView>('/api/tiktok/profile'),
  videos: (limit = 20) => api.get<TikTokVideosView>(`/api/tiktok/videos?limit=${limit}`),
};

export const tiktokImportApi = {
  get: () => api.get<ActivityImportResponse>('/api/tiktok/import'),
  request: () => api.post<ActivityImportResponse>('/api/tiktok/import/request'),
  refresh: () => api.post<ActivityImportResponse>('/api/tiktok/import/refresh'),
  remove: () => api.delete<ActivityImportResponse & { ok: boolean }>('/api/tiktok/import'),
};

export const roomsApi = {
  config: () => api.get<PublicServerConfig>('/api/config'),
  create: (name: string, avatarSeed: number) =>
    api.post<CreateRoomResult>('/api/rooms', { name, avatarSeed }),
  info: (code: string) => api.get<PublicRoomInfo>(`/api/rooms/${code}`),
  join: (code: string, name: string, avatarSeed: number) =>
    api.post<JoinRoomResult>(`/api/rooms/${code}/join`, { name, avatarSeed }),
};
