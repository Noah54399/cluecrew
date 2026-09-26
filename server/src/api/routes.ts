import express, { type Request, type Router } from 'express';
import { z } from 'zod';
import {
  AVATAR_SEED_COUNT,
  BRAND,
  DEFAULT_SETTINGS,
  MODES,
  MODE_IDS,
  OFFICIAL_TIKTOK_ACCESS,
  SCORING_RULES,
  SETTINGS_LIMITS,
  isValidRoomCode,
  normalizeRoomCode,
  normalizeAvatarSeed,
  sanitizeDisplayName,
  type ActivityImportState,
  type PublicServerConfig,
  type TikTokProfileView,
  type TikTokVideosView,
} from '@cluecrew/shared';
import type { ServerConfig } from '../config.js';
import type { OauthAccountRow, Repositories, UserRow } from '../database/repositories.js';
import type { SessionService } from '../auth/sessions.js';
import { TikTokOAuthService } from '../auth/tiktokOAuth.js';
import { encryptString } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { asyncHandler, rateLimit, requireCsrf } from '../lib/http.js';
import { SlidingWindowLimiter } from '../lib/rateLimit.js';
import type { RoomManager } from '../game/roomManager.js';
import type { DataPortabilityService } from '../portability/DataPortabilityService.js';
import {
  clearAccountCache,
  loadTikTokProfile,
  loadTikTokVideos,
} from '../providers/tiktok/accountData.js';

const guestSchema = z.object({
  name: z.string().min(1).max(60),
  avatarSeed: z.number().int().optional(),
});

const joinSchema = z.object({
  name: z.string().min(1).max(60),
  avatarSeed: z.number().int().optional(),
});

export interface ApiDeps {
  config: ServerConfig;
  repos: Repositories;
  sessions: SessionService;
  oauth: TikTokOAuthService;
  roomManager: RoomManager;
  dataPortability: DataPortabilityService | null;
}

export function createApiRouter(deps: ApiDeps): Router {
  const { config, repos, sessions, oauth, roomManager, dataPortability } = deps;
  const router = express.Router();

  const generalLimiter = new SlidingWindowLimiter(240, 60_000);
  const createRoomLimiter = new SlidingWindowLimiter(15, 10 * 60_000);
  const joinLimiter = new SlidingWindowLimiter(40, 60_000);
  const guestLimiter = new SlidingWindowLimiter(30, 10 * 60_000);
  const oauthLimiter = new SlidingWindowLimiter(20, 10 * 60_000);
  const importLimiter = new SlidingWindowLimiter(60, 10 * 60_000);

  const emptyImportState = (): ActivityImportState => ({
    enabled: dataPortability?.enabled ?? false,
    scopeGranted: false,
    scope: config.dataPortability.scope,
    status: 'none',
    requestedAt: null,
    lastCheckedAt: null,
    readyAt: null,
    expiresAt: null,
    counts: { like: 0, save: 0, repost: 0, post: 0 },
    skipped: 0,
    error: null,
    note: null,
  });

  router.use(rateLimit(generalLimiter, 'general'));

  // -------------------------------------------------------------------------
  // Health & config
  // -------------------------------------------------------------------------

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      name: BRAND.name,
      protocolVersion: BRAND.protocolVersion,
      uptimeSeconds: Math.round(process.uptime()),
      rooms: repos.rooms.count(),
      provider: 'sqlite',
    });
  });

  router.get('/config', (_req, res) => {
    const payload: PublicServerConfig = {
      brand: BRAND,
      tiktokConfigured: config.tiktok.configured,
      tiktokScopes: config.tiktok.scopes,
      maxPlayersPerRoom: config.maxPlayersPerRoom,
      settingsLimits: SETTINGS_LIMITS,
      defaultSettings: DEFAULT_SETTINGS,
      scoringRules: SCORING_RULES,
      modeInfo: Object.fromEntries(
        MODE_IDS.map((modeId) => [
          modeId,
          { ...MODES[modeId], official: OFFICIAL_TIKTOK_ACCESS[modeId] },
        ]),
      ) as PublicServerConfig['modeInfo'],
      dataPortability: {
        enabled: dataPortability?.enabled ?? false,
        scope: dataPortability?.enabled ? config.dataPortability.scope : null,
        categories: dataPortability?.enabled ? config.dataPortability.categories : [],
      },
    };
    res.json(payload);
  });

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  const sessionPayload = (user: UserRow | null, csrfToken: string | null) => ({
    user: null as null | { id: string; displayName: string; avatarSeed: number },
    csrfToken,
    tiktok: {
      configured: config.tiktok.configured,
      ...(user
        ? oauth.getLinkedAccount(user.id)
        : {
            linked: false,
            providerUserId: null,
            displayName: null,
            avatarUrl: null,
            scopes: [],
            canSupply: { like: false, repost: false, save: false, post: false },
            connectedAt: null,
          }),
    },
    import:
      user && dataPortability ? dataPortability.getState(user.id) : emptyImportState(),
    server: {
      avatarSeedCount: AVATAR_SEED_COUNT,
    },
  });

  router.get('/session', (req, res) => {
    const auth = sessions.getAuth(req);
    const payload = sessionPayload(auth?.user ?? null, auth?.session.csrfToken ?? null);
    if (auth) {
      payload.user = {
        id: auth.user.id,
        displayName: auth.user.displayName,
        avatarSeed: auth.user.avatarSeed,
      };
    }
    res.json(payload);
  });

  router.post(
    '/session/guest',
    rateLimit(guestLimiter, 'guest'),
    requireCsrf(sessions),
    asyncHandler((req, res) => {
      const parsed = guestSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new AppError('VALIDATION_FAILED');
      const name = sanitizeDisplayName(parsed.data.name);
      if (!name) throw new AppError('NAME_INVALID');
      const avatarSeed = normalizeAvatarSeed(parsed.data.avatarSeed ?? 0);

      const auth = sessions.getAuth(req);
      if (auth) {
        repos.users.update(auth.user.id, { displayName: name, avatarSeed, now: new Date().toISOString() });
        const payload = sessionPayload(
          { ...auth.user, displayName: name, avatarSeed },
          auth.session.csrfToken,
        );
        payload.user = { id: auth.user.id, displayName: name, avatarSeed };
        res.json(payload);
        return;
      }
      const created = sessions.createUserWithSession({ displayName: name, avatarSeed });
      sessions.attachSessionCookie(res, created.session);
      const payload = sessionPayload(created.user, created.session.csrfToken);
      payload.user = {
        id: created.user.id,
        displayName: created.user.displayName,
        avatarSeed: created.user.avatarSeed,
      };
      res.status(201).json(payload);
    }),
  );

  router.delete(
    '/session',
    requireCsrf(sessions),
    asyncHandler((req, res) => {
      sessions.destroySession(req);
      sessions.clearSessionCookie(res);
      res.json({ ok: true });
    }),
  );

  router.delete(
    '/me',
    requireCsrf(sessions),
    asyncHandler(async (req, res) => {
      const auth = sessions.getAuth(req);
      if (!auth) throw new AppError('UNAUTHORIZED');
      const userId = auth.user.id;
      await oauth.disconnect(userId);
      roomManager.handleUserDeleted(userId);
      sessions.destroySession(req);
      sessions.clearSessionCookie(res);
      sessions.deleteUserData(userId);
      res.json({ ok: true });
    }),
  );

  // -------------------------------------------------------------------------
  // TikTok OAuth
  // -------------------------------------------------------------------------

  router.post(
    '/auth/tiktok/start-url',
    rateLimit(oauthLimiter, 'oauth'),
    requireCsrf(sessions),
    asyncHandler((req, res) => {
      if (!oauth.isConfigured()) throw new AppError('TIKTOK_NOT_CONFIGURED');
      // First-time visitors can connect immediately: create a guest session
      // on the fly (the TikTok profile becomes their identity, no name prompt).
      let auth = sessions.getAuth(req);
      if (!auth) {
        auth = sessions.createUserWithSession({ displayName: 'TikTok user', avatarSeed: 0 });
        sessions.attachSessionCookie(res, auth.session);
      }
      const url = oauth.createAuthorizeUrl({
        userId: auth.user.id,
        returnTo: (req.body ?? {}).returnTo,
      });
      res.json({ url });
    }),
  );

  router.get(
    '/auth/tiktok/start',
    rateLimit(oauthLimiter, 'oauth'),
    asyncHandler((req, res) => {
      if (!oauth.isConfigured()) throw new AppError('TIKTOK_NOT_CONFIGURED');
      let auth = sessions.getAuth(req);
      if (!auth) {
        auth = sessions.createUserWithSession({ displayName: 'TikTok user', avatarSeed: 0 });
        sessions.attachSessionCookie(res, auth.session);
      }
      const url = oauth.createAuthorizeUrl({
        userId: auth.user.id,
        returnTo: req.query.returnTo,
      });
      res.redirect(url);
    }),
  );

  router.get(
    '/auth/tiktok/callback',
    asyncHandler(async (req, res) => {
      const result = await oauth.handleCallback({
        code: req.query.code,
        state: req.query.state,
        error: req.query.error,
        errorDescription: req.query.error_description,
      });
      const target = new URL(result.returnTo, config.clientUrl);
      target.searchParams.set('tiktok', 'connected');
      res.redirect(target.toString());
    }),
  );

  router.post(
    '/auth/tiktok/disconnect',
    requireCsrf(sessions),
    asyncHandler(async (req, res) => {
      const auth = sessions.getAuth(req);
      if (!auth) throw new AppError('UNAUTHORIZED');
      await oauth.disconnect(auth.user.id);
      clearAccountCache(auth.user.id);
      res.json({ ok: true, tiktok: oauth.getLinkedAccount(auth.user.id) });
    }),
  );

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------

  router.post(
    '/rooms',
    rateLimit(createRoomLimiter, 'create-room'),
    requireCsrf(sessions),
    asyncHandler((req, res) => {
      const parsed = joinSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new AppError('VALIDATION_FAILED');
      const name = sanitizeDisplayName(parsed.data.name);
      if (!name) throw new AppError('NAME_INVALID');
      const avatarSeed = normalizeAvatarSeed(parsed.data.avatarSeed ?? 0);

      let auth = sessions.getAuth(req);
      if (!auth) {
        auth = sessions.createUserWithSession({ displayName: name, avatarSeed });
        sessions.attachSessionCookie(res, auth.session);
      } else {
        repos.users.update(auth.user.id, { displayName: name, avatarSeed, now: new Date().toISOString() });
      }

      const { room, player, playerToken } = roomManager.createRoom({
        name,
        avatarSeed,
        userId: auth.user.id,
      });
      res.status(201).json({
        code: room.code,
        playerId: player.id,
        playerToken,
        csrfToken: auth.session.csrfToken,
      });
    }),
  );

  router.get(
    '/rooms/:code',
    asyncHandler((req, res) => {
      const code = normalizeRoomCode(req.params.code);
      if (!code || !isValidRoomCode(code)) throw new AppError('ROOM_NOT_FOUND');
      const info = roomManager.getPublicRoomInfo(code);
      if (!info) throw new AppError('ROOM_NOT_FOUND');
      res.json(info);
    }),
  );

  router.post(
    '/rooms/:code/join',
    rateLimit(joinLimiter, 'join'),
    requireCsrf(sessions),
    asyncHandler((req, res) => {
      const code = normalizeRoomCode(req.params.code);
      if (!code || !isValidRoomCode(code)) throw new AppError('ROOM_NOT_FOUND');
      const parsed = joinSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new AppError('VALIDATION_FAILED');
      const name = sanitizeDisplayName(parsed.data.name);
      if (!name) throw new AppError('NAME_INVALID');
      const avatarSeed = normalizeAvatarSeed(parsed.data.avatarSeed ?? 0);

      let auth = sessions.getAuth(req);
      if (!auth) {
        auth = sessions.createUserWithSession({ displayName: name, avatarSeed });
        sessions.attachSessionCookie(res, auth.session);
      } else {
        repos.users.update(auth.user.id, { displayName: name, avatarSeed, now: new Date().toISOString() });
      }

      const { room, player, playerToken } = roomManager.joinRoom({
        code,
        name,
        avatarSeed,
        userId: auth.user.id,
      });
      res.status(201).json({
        code: room.code,
        playerId: player.id,
        playerToken,
        csrfToken: auth.session.csrfToken,
        room: roomManager.getPublicRoomInfo(room.code),
      });
    }),
  );

  // -------------------------------------------------------------------------
  // TikTok account data (real Display API data for the account page)
  // -------------------------------------------------------------------------

  const persistRefreshedTokens =
    (account: OauthAccountRow) =>
    (tokens: {
      accessToken: string;
      refreshToken: string | null;
      accessTokenExpiresAt: number;
      refreshTokenExpiresAt: number | null;
      scopes: string[];
    }) => {
      try {
        repos.oauthAccounts.updateTokens(account.id, {
          accessTokenEnc: encryptString(tokens.accessToken, config.tokenEncryptionKey),
          refreshTokenEnc: tokens.refreshToken
            ? encryptString(tokens.refreshToken, config.tokenEncryptionKey)
            : null,
          accessTokenExpiresAt: new Date(tokens.accessTokenExpiresAt).toISOString(),
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
            ? new Date(tokens.refreshTokenExpiresAt).toISOString()
            : null,
          scopes: tokens.scopes.join(','),
          now: new Date().toISOString(),
        });
      } catch {
        // Token persistence is best-effort.
      }
    };

  const notConnectedProfile = (message: string): TikTokProfileView => ({
    connected: false,
    needsReconnect: false,
    openId: null,
    displayName: null,
    avatarUrl: null,
    username: null,
    bioDescription: null,
    profileDeepLink: null,
    isVerified: null,
    stats: null,
    scopesRequested: config.tiktok.scopes,
    scopesGranted: [],
    scopesMissing: config.tiktok.scopes,
    unavailable: [],
    connectedAt: null,
    accessTokenExpiresAt: null,
    message,
  });

  const emptyVideos = (reason: string): TikTokVideosView => ({
    available: false,
    needsReconnect: false,
    reason,
    requiredScope: 'video.list',
    videos: [],
  });

  const tiktokAccountFor = (req: Request) => {
    const auth = sessions.getAuth(req);
    if (!auth) return null;
    return repos.oauthAccounts.getForUser(auth.user.id, 'tiktok');
  };

  router.get(
    '/tiktok/profile',
    rateLimit(importLimiter, 'account'),
    asyncHandler(async (req, res) => {
      if (!config.tiktok.configured) {
        res.json(
          notConnectedProfile(
            'TikTok sign-in is not configured on this server, so real data is unavailable.',
          ),
        );
        return;
      }
      const account = tiktokAccountFor(req);
      if (!account) {
        res.json(notConnectedProfile('Connect your TikTok account to see your real data.'));
        return;
      }
      const profile = await loadTikTokProfile({
        account,
        config,
        onTokensRefreshed: persistRefreshedTokens(account),
      });
      res.json(profile);
    }),
  );

  router.get(
    '/tiktok/videos',
    rateLimit(importLimiter, 'account'),
    asyncHandler(async (req, res) => {
      if (!config.tiktok.configured) {
        res.json(emptyVideos('TikTok sign-in is not configured on this server.'));
        return;
      }
      const account = tiktokAccountFor(req);
      if (!account) {
        res.json(emptyVideos('Connect your TikTok account to see your real data.'));
        return;
      }
      const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 20;
      const videos = await loadTikTokVideos({
        account,
        config,
        limit: Number.isFinite(limitRaw) ? limitRaw : 20,
        onTokensRefreshed: persistRefreshedTokens(account),
      });
      res.json(videos);
    }),
  );

  // -------------------------------------------------------------------------
  // TikTok Data Portability (activity import)
  // -------------------------------------------------------------------------

  const importPayload = (userId: string | null) => {
    const state =
      userId && dataPortability ? dataPortability.getState(userId) : emptyImportState();
    const linked = userId ? oauth.getLinkedAccount(userId).linked : false;
    return { linked, ...state };
  };

  router.get(
    '/tiktok/import',
    asyncHandler((req, res) => {
      const auth = sessions.getAuth(req);
      res.json(importPayload(auth?.user.id ?? null));
    }),
  );

  router.post(
    '/tiktok/import/request',
    rateLimit(importLimiter, 'import'),
    requireCsrf(sessions),
    asyncHandler(async (req, res) => {
      const auth = sessions.getAuth(req);
      if (!auth) throw new AppError('UNAUTHORIZED');
      if (!dataPortability) throw new AppError('TIKTOK_DP_NOT_ENABLED');
      await dataPortability.startImport(auth.user.id);
      res.json(importPayload(auth.user.id));
    }),
  );

  router.post(
    '/tiktok/import/refresh',
    rateLimit(importLimiter, 'import'),
    requireCsrf(sessions),
    asyncHandler(async (req, res) => {
      const auth = sessions.getAuth(req);
      if (!auth) throw new AppError('UNAUTHORIZED');
      if (!dataPortability) throw new AppError('TIKTOK_DP_NOT_ENABLED');
      await dataPortability.refresh(auth.user.id, { force: true });
      res.json(importPayload(auth.user.id));
    }),
  );

  router.delete(
    '/tiktok/import',
    requireCsrf(sessions),
    asyncHandler((req, res) => {
      const auth = sessions.getAuth(req);
      if (!auth) throw new AppError('UNAUTHORIZED');
      dataPortability?.deleteImport(auth.user.id);
      res.json({ ok: true, ...importPayload(auth.user.id) });
    }),
  );

  return router;
}
