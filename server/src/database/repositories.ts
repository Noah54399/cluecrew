import type { Db } from './driver.js';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  displayName: string;
  avatarSeed: number;
  preferredSource: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRow {
  id: string;
  userId: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
}

export interface OauthStateRow {
  id: string;
  userId: string;
  returnTo: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface OauthAccountRow {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  scopes: string;
  capabilitiesJson: string;
  connectedAt: string;
  updatedAt: string;
}

export interface RoomRow {
  id: string;
  code: string;
  hostPlayerId: string | null;
  settingsJson: string;
  stateJson: string | null;
  status: string;
  phase: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface PlayerRow {
  id: string;
  roomId: string;
  userId: string | null;
  name: string;
  avatarSeed: number;
  avatarUrl: string | null;
  reconnectTokenHash: string;
  isHost: number;
  source: string;
  joinedAt: string;
  lastSeenAt: string;
}

export interface GameRow {
  id: string;
  roomId: string;
  roundCount: number;
  scoringMode: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

export interface RoundRow {
  id: string;
  gameId: string;
  roundNumber: number;
  mode: string;
  actorPlayerId: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

export interface GuessRow {
  id: string;
  roundId: string;
  playerId: string;
  guessedPlayerId: string | null;
  submittedAt: string;
  isCorrect: number | null;
  points: number | null;
}

export interface ScoreRow {
  playerId: string;
  points: number;
  correctGuesses: number;
  timesActor: number;
}

export interface ActivityImportRow {
  id: string;
  userId: string;
  provider: string;
  scope: string;
  categoriesJson: string;
  tiktokRequestId: string | null;
  status: string;
  dataFormat: string;
  requestedAt: string;
  lastCheckedAt: string | null;
  readyAt: string | null;
  expiresAt: string | null;
  archivePath: string | null;
  skippedCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialActionRow {
  id: string;
  userId: string;
  provider: string;
  kind: string;
  contentId: string;
  contentUrl: string;
  occurredAt: string | null;
  title: string | null;
  authorName: string | null;
  coverUrl: string | null;
  enrichmentStatus: string;
  createdAt: string;
}

const USER_COLUMNS = 'id, display_name AS displayName, avatar_seed AS avatarSeed, preferred_source AS preferredSource, created_at AS createdAt, updated_at AS updatedAt';
const SESSION_COLUMNS = 'id, user_id AS userId, csrf_token AS csrfToken, created_at AS createdAt, expires_at AS expiresAt';
const OAUTH_STATE_COLUMNS = 'id, user_id AS userId, return_to AS returnTo, created_at AS createdAt, expires_at AS expiresAt';
const OAUTH_ACCOUNT_COLUMNS = `id, user_id AS userId, provider, provider_user_id AS providerUserId,
  display_name AS displayName, avatar_url AS avatarUrl,
  access_token_enc AS accessTokenEnc, refresh_token_enc AS refreshTokenEnc,
  access_token_expires_at AS accessTokenExpiresAt, refresh_token_expires_at AS refreshTokenExpiresAt,
  scopes, capabilities_json AS capabilitiesJson, connected_at AS connectedAt, updated_at AS updatedAt`;
const ROOM_COLUMNS = `id, code, host_player_id AS hostPlayerId, settings_json AS settingsJson,
  state_json AS stateJson, status, phase, created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt`;
const PLAYER_COLUMNS = `id, room_id AS roomId, user_id AS userId, name, avatar_seed AS avatarSeed,
  avatar_url AS avatarUrl, reconnect_token_hash AS reconnectTokenHash, is_host AS isHost,
  source, joined_at AS joinedAt, last_seen_at AS lastSeenAt`;
const GAME_COLUMNS = 'id, room_id AS roomId, round_count AS roundCount, scoring_mode AS scoringMode, status, started_at AS startedAt, ended_at AS endedAt';
const ROUND_COLUMNS = 'id, game_id AS gameId, round_number AS roundNumber, mode, actor_player_id AS actorPlayerId, status, started_at AS startedAt, ended_at AS endedAt';
const GUESS_COLUMNS = 'id, round_id AS roundId, player_id AS playerId, guessed_player_id AS guessedPlayerId, submitted_at AS submittedAt, is_correct AS isCorrect, points';
const ACTIVITY_IMPORT_COLUMNS = `id, user_id AS userId, provider, scope, categories_json AS categoriesJson,
  tiktok_request_id AS tiktokRequestId, status, data_format AS dataFormat, requested_at AS requestedAt,
  last_checked_at AS lastCheckedAt, ready_at AS readyAt, expires_at AS expiresAt, archive_path AS archivePath,
  skipped_count AS skippedCount, error_code AS errorCode, error_message AS errorMessage,
  created_at AS createdAt, updated_at AS updatedAt`;
const SOCIAL_ACTION_COLUMNS = `id, user_id AS userId, provider, kind, content_id AS contentId,
  content_url AS contentUrl, occurred_at AS occurredAt, title, author_name AS authorName,
  cover_url AS coverUrl, enrichment_status AS enrichmentStatus, created_at AS createdAt`;

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export function createRepositories(db: Db) {
  const users = {
    create(row: { id: string; displayName: string; avatarSeed: number; now: string }): void {
      db.prepare(
        'INSERT INTO users (id, display_name, avatar_seed, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(row.id, row.displayName, row.avatarSeed, row.now, row.now);
    },
    get(id: string): UserRow | null {
      const row = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id);
      return (row as UserRow | undefined) ?? null;
    },
    update(id: string, patch: { displayName?: string; avatarSeed?: number; preferredSource?: string; now: string }): void {
      const sets: string[] = ['updated_at = ?'];
      const params: unknown[] = [patch.now];
      if (patch.displayName !== undefined) {
        sets.push('display_name = ?');
        params.push(patch.displayName);
      }
      if (patch.avatarSeed !== undefined) {
        sets.push('avatar_seed = ?');
        params.push(patch.avatarSeed);
      }
      if (patch.preferredSource !== undefined) {
        sets.push('preferred_source = ?');
        params.push(patch.preferredSource);
      }
      params.push(id);
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    },
    delete(id: string): void {
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    },
  };

  const sessions = {
    create(row: { id: string; userId: string; csrfToken: string; createdAt: string; expiresAt: string }): void {
      db.prepare(
        'INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      ).run(row.id, row.userId, row.csrfToken, row.createdAt, row.expiresAt);
    },
    get(id: string): SessionRow | null {
      const row = db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).get(id);
      return (row as SessionRow | undefined) ?? null;
    },
    delete(id: string): void {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    },
    deleteForUser(userId: string): void {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    },
    deleteExpired(nowIso: string): number {
      return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso).changes;
    },
  };

  const oauthStates = {
    create(row: { id: string; userId: string; returnTo: string | null; createdAt: string; expiresAt: string }): void {
      db.prepare(
        'INSERT INTO oauth_states (id, user_id, return_to, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      ).run(row.id, row.userId, row.returnTo, row.createdAt, row.expiresAt);
    },
    /** One-time use: returns and deletes in a single transaction. */
    consume(id: string, nowIso: string): OauthStateRow | null {
      return db.transaction(() => {
        const row = db
          .prepare(`SELECT ${OAUTH_STATE_COLUMNS} FROM oauth_states WHERE id = ?`)
          .get(id) as OauthStateRow | undefined;
        if (!row) return null;
        db.prepare('DELETE FROM oauth_states WHERE id = ?').run(id);
        if (row.expiresAt <= nowIso) return null;
        return row;
      });
    },
    deleteExpired(nowIso: string): number {
      return db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').run(nowIso).changes;
    },
  };

  const oauthAccounts = {
    save(row: {
      id: string;
      userId: string;
      provider: string;
      providerUserId: string;
      displayName: string | null;
      avatarUrl: string | null;
      accessTokenEnc: string | null;
      refreshTokenEnc: string | null;
      accessTokenExpiresAt: string | null;
      refreshTokenExpiresAt: string | null;
      scopes: string;
      capabilitiesJson: string;
      now: string;
    }): void {
      db.transaction(() => {
        // A TikTok account can only be linked to one ClueCrew user at a time.
        db.prepare('DELETE FROM oauth_accounts WHERE provider = ? AND provider_user_id = ? AND user_id <> ?').run(
          row.provider,
          row.providerUserId,
          row.userId,
        );
        db.prepare(
          `INSERT INTO oauth_accounts (
             id, user_id, provider, provider_user_id, display_name, avatar_url,
             access_token_enc, refresh_token_enc, access_token_expires_at, refresh_token_expires_at,
             scopes, capabilities_json, connected_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, provider) DO UPDATE SET
             provider_user_id = excluded.provider_user_id,
             display_name = excluded.display_name,
             avatar_url = excluded.avatar_url,
             access_token_enc = excluded.access_token_enc,
             refresh_token_enc = excluded.refresh_token_enc,
             access_token_expires_at = excluded.access_token_expires_at,
             refresh_token_expires_at = excluded.refresh_token_expires_at,
             scopes = excluded.scopes,
             capabilities_json = excluded.capabilities_json,
             updated_at = excluded.updated_at`,
        ).run(
          row.id,
          row.userId,
          row.provider,
          row.providerUserId,
          row.displayName,
          row.avatarUrl,
          row.accessTokenEnc,
          row.refreshTokenEnc,
          row.accessTokenExpiresAt,
          row.refreshTokenExpiresAt,
          row.scopes,
          row.capabilitiesJson,
          row.now,
          row.now,
        );
      });
    },
    getForUser(userId: string, provider: string): OauthAccountRow | null {
      const row = db
        .prepare(`SELECT ${OAUTH_ACCOUNT_COLUMNS} FROM oauth_accounts WHERE user_id = ? AND provider = ?`)
        .get(userId, provider);
      return (row as OauthAccountRow | undefined) ?? null;
    },
    updateTokens(
      id: string,
      patch: {
        accessTokenEnc: string | null;
        refreshTokenEnc: string | null;
        accessTokenExpiresAt: string | null;
        refreshTokenExpiresAt: string | null;
        scopes?: string;
        now: string;
      },
    ): void {
      db.prepare(
        `UPDATE oauth_accounts SET access_token_enc = ?, refresh_token_enc = ?,
           access_token_expires_at = ?, refresh_token_expires_at = ?,
           scopes = COALESCE(?, scopes), updated_at = ?
         WHERE id = ?`,
      ).run(
        patch.accessTokenEnc,
        patch.refreshTokenEnc,
        patch.accessTokenExpiresAt,
        patch.refreshTokenExpiresAt,
        patch.scopes ?? null,
        patch.now,
        id,
      );
    },
    deleteForUser(userId: string, provider: string): void {
      db.prepare('DELETE FROM oauth_accounts WHERE user_id = ? AND provider = ?').run(userId, provider);
    },
  };

  const rooms = {
    create(row: {
      id: string;
      code: string;
      hostPlayerId: string | null;
      settingsJson: string;
      status: string;
      phase: string;
      now: string;
      expiresAt: string;
    }): void {
      db.prepare(
        `INSERT INTO game_rooms (id, code, host_player_id, settings_json, state_json, status, phase, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      ).run(
        row.id,
        row.code,
        row.hostPlayerId,
        row.settingsJson,
        row.status,
        row.phase,
        row.now,
        row.now,
        row.expiresAt,
      );
    },
    getByCode(code: string): RoomRow | null {
      const row = db.prepare(`SELECT ${ROOM_COLUMNS} FROM game_rooms WHERE code = ?`).get(code);
      return (row as RoomRow | undefined) ?? null;
    },
    getById(id: string): RoomRow | null {
      const row = db.prepare(`SELECT ${ROOM_COLUMNS} FROM game_rooms WHERE id = ?`).get(id);
      return (row as RoomRow | undefined) ?? null;
    },
    update(
      id: string,
      patch: {
        hostPlayerId?: string | null;
        settingsJson?: string;
        stateJson?: string | null;
        status?: string;
        phase?: string;
        now: string;
        expiresAt?: string;
      },
    ): void {
      const sets: string[] = ['updated_at = ?'];
      const params: unknown[] = [patch.now];
      if (patch.hostPlayerId !== undefined) {
        sets.push('host_player_id = ?');
        params.push(patch.hostPlayerId);
      }
      if (patch.settingsJson !== undefined) {
        sets.push('settings_json = ?');
        params.push(patch.settingsJson);
      }
      if (patch.stateJson !== undefined) {
        sets.push('state_json = ?');
        params.push(patch.stateJson);
      }
      if (patch.status !== undefined) {
        sets.push('status = ?');
        params.push(patch.status);
      }
      if (patch.phase !== undefined) {
        sets.push('phase = ?');
        params.push(patch.phase);
      }
      if (patch.expiresAt !== undefined) {
        sets.push('expires_at = ?');
        params.push(patch.expiresAt);
      }
      params.push(id);
      db.prepare(`UPDATE game_rooms SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    },
    delete(id: string): void {
      db.prepare('DELETE FROM game_rooms WHERE id = ?').run(id);
    },
    deleteExpired(nowIso: string): number {
      const rows = db.prepare('SELECT id FROM game_rooms WHERE expires_at <= ?').all(nowIso);
      if (rows.length === 0) return 0;
      db.prepare('DELETE FROM game_rooms WHERE expires_at <= ?').run(nowIso);
      return rows.length;
    },
    count(): number {
      const row = db.prepare('SELECT COUNT(*) AS count FROM game_rooms').get();
      return Number(row?.count ?? 0);
    },
  };

  const players = {
    create(row: {
      id: string;
      roomId: string;
      userId: string | null;
      name: string;
      avatarSeed: number;
      avatarUrl: string | null;
      reconnectTokenHash: string;
      isHost: number;
      source: string;
      now: string;
    }): void {
      db.prepare(
        `INSERT INTO game_players (id, room_id, user_id, name, avatar_seed, avatar_url, reconnect_token_hash, is_host, source, joined_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id,
        row.roomId,
        row.userId,
        row.name,
        row.avatarSeed,
        row.avatarUrl,
        row.reconnectTokenHash,
        row.isHost,
        row.source,
        row.now,
        row.now,
      );
    },
    get(id: string): PlayerRow | null {
      const row = db.prepare(`SELECT ${PLAYER_COLUMNS} FROM game_players WHERE id = ?`).get(id);
      return (row as PlayerRow | undefined) ?? null;
    },
    getForUser(userId: string, roomId: string): PlayerRow | null {
      const row = db
        .prepare(`SELECT ${PLAYER_COLUMNS} FROM game_players WHERE user_id = ? AND room_id = ?`)
        .get(userId, roomId);
      return (row as PlayerRow | undefined) ?? null;
    },
    listForRoom(roomId: string): PlayerRow[] {
      return db
        .prepare(`SELECT ${PLAYER_COLUMNS} FROM game_players WHERE room_id = ? ORDER BY joined_at ASC`)
        .all(roomId) as unknown as PlayerRow[];
    },
    listForUser(userId: string): PlayerRow[] {
      return db
        .prepare(`SELECT ${PLAYER_COLUMNS} FROM game_players WHERE user_id = ?`)
        .all(userId) as unknown as PlayerRow[];
    },
    update(
      id: string,
      patch: {
        name?: string;
        avatarSeed?: number;
        avatarUrl?: string | null;
        reconnectTokenHash?: string;
        isHost?: number;
        source?: string;
        userId?: string | null;
        now: string;
      },
    ): void {
      const sets: string[] = ['last_seen_at = ?'];
      const params: unknown[] = [patch.now];
      for (const [column, value] of [
        ['name', patch.name],
        ['avatar_seed', patch.avatarSeed],
        ['avatar_url', patch.avatarUrl],
        ['reconnect_token_hash', patch.reconnectTokenHash],
        ['is_host', patch.isHost],
        ['source', patch.source],
        ['user_id', patch.userId],
      ] as const) {
        if (value !== undefined) {
          sets.push(`${column} = ?`);
          params.push(value);
        }
      }
      params.push(id);
      db.prepare(`UPDATE game_players SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    },
    delete(id: string): void {
      db.prepare('DELETE FROM game_players WHERE id = ?').run(id);
    },
    countForRoom(roomId: string): number {
      const row = db.prepare('SELECT COUNT(*) AS count FROM game_players WHERE room_id = ?').get(roomId);
      return Number(row?.count ?? 0);
    },
    nameExists(roomId: string, name: string, excludePlayerId?: string): boolean {
      const row = excludePlayerId
        ? db
            .prepare('SELECT id FROM game_players WHERE room_id = ? AND LOWER(name) = LOWER(?) AND id <> ? LIMIT 1')
            .get(roomId, name, excludePlayerId)
        : db
            .prepare('SELECT id FROM game_players WHERE room_id = ? AND LOWER(name) = LOWER(?) LIMIT 1')
            .get(roomId, name);
      return Boolean(row);
    },
  };

  const games = {
    create(row: { id: string; roomId: string; roundCount: number; scoringMode: string; now: string }): void {
      db.prepare(
        'INSERT INTO games (id, room_id, round_count, scoring_mode, status, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, NULL)',
      ).run(row.id, row.roomId, row.roundCount, row.scoringMode, 'active', row.now);
    },
    finish(id: string, status: 'finished' | 'aborted', nowIso: string): void {
      db.prepare('UPDATE games SET status = ?, ended_at = ? WHERE id = ?').run(status, nowIso, id);
    },
    get(id: string): GameRow | null {
      const row = db.prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE id = ?`).get(id);
      return (row as GameRow | undefined) ?? null;
    },
  };

  const rounds = {
    create(row: {
      id: string;
      gameId: string;
      roundNumber: number;
      mode: string;
      actorPlayerId: string;
      now: string;
    }): void {
      db.prepare(
        'INSERT INTO rounds (id, game_id, round_number, mode, actor_player_id, status, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
      ).run(row.id, row.gameId, row.roundNumber, row.mode, row.actorPlayerId, 'active', row.now);
    },
    finish(id: string, status: 'revealed' | 'skipped', nowIso: string): void {
      db.prepare('UPDATE rounds SET status = ?, ended_at = ? WHERE id = ?').run(status, nowIso, id);
    },
    get(id: string): RoundRow | null {
      const row = db.prepare(`SELECT ${ROUND_COLUMNS} FROM rounds WHERE id = ?`).get(id);
      return (row as RoundRow | undefined) ?? null;
    },
    listForGame(gameId: string): RoundRow[] {
      return db
        .prepare(`SELECT ${ROUND_COLUMNS} FROM rounds WHERE game_id = ? ORDER BY round_number ASC`)
        .all(gameId) as unknown as RoundRow[];
    },
  };

  const roundActions = {
    create(row: {
      id: string;
      roundId: string;
      provider: string;
      kind: string;
      contentId: string;
      contentJson: string;
      isMock: number;
      now: string;
    }): void {
      db.prepare(
        'INSERT INTO round_actions (id, round_id, provider, kind, content_id, content_json, is_mock, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        row.id,
        row.roundId,
        row.provider,
        row.kind,
        row.contentId,
        row.contentJson,
        row.isMock,
        row.now,
      );
    },
  };

  const guesses = {
    upsert(row: {
      id: string;
      roundId: string;
      playerId: string;
      guessedPlayerId: string;
      submittedAt: string;
    }): void {
      db.prepare(
        `INSERT INTO guesses (id, round_id, player_id, guessed_player_id, submitted_at, is_correct, points)
         VALUES (?, ?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(round_id, player_id) DO UPDATE SET
           guessed_player_id = excluded.guessed_player_id,
           submitted_at = excluded.submitted_at`,
      ).run(row.id, row.roundId, row.playerId, row.guessedPlayerId, row.submittedAt);
    },
    resolve(roundId: string, playerId: string, isCorrect: boolean, points: number): void {
      db.prepare('UPDATE guesses SET is_correct = ?, points = ? WHERE round_id = ? AND player_id = ?').run(
        isCorrect ? 1 : 0,
        points,
        roundId,
        playerId,
      );
    },
    listForRound(roundId: string): GuessRow[] {
      return db
        .prepare(`SELECT ${GUESS_COLUMNS} FROM guesses WHERE round_id = ? ORDER BY submitted_at ASC`)
        .all(roundId) as unknown as GuessRow[];
    },
  };

  const scores = {
    insert(row: {
      id: string;
      gameId: string;
      playerId: string;
      roundId: string | null;
      points: number;
      reason: string;
      now: string;
    }): void {
      db.prepare(
        'INSERT INTO scores (id, game_id, player_id, round_id, points, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(row.id, row.gameId, row.playerId, row.roundId, row.points, row.reason, row.now);
    },
    /**
     * Aggregated scoreboard for a game: total points, number of correct guesses and
     * how often a player was the actor.
     */
    totalsForGame(gameId: string): ScoreRow[] {
      return db
        .prepare(
          `SELECT
             p.player_id AS playerId,
             COALESCE(s.points, 0) AS points,
             COALESCE(g.correctGuesses, 0) AS correctGuesses,
             COALESCE(r.timesActor, 0) AS timesActor
           FROM (
             SELECT DISTINCT player_id FROM (
               SELECT player_id FROM scores WHERE game_id = ?
               UNION SELECT player_id FROM guesses gu JOIN rounds ro ON ro.id = gu.round_id WHERE ro.game_id = ?
             )
           ) p
           LEFT JOIN (SELECT player_id, SUM(points) AS points FROM scores WHERE game_id = ? GROUP BY player_id) s
             ON s.player_id = p.player_id
           LEFT JOIN (
             SELECT gu.player_id, COUNT(*) AS correctGuesses FROM guesses gu
             JOIN rounds ro ON ro.id = gu.round_id
             WHERE ro.game_id = ? AND gu.is_correct = 1 GROUP BY gu.player_id
           ) g ON g.player_id = p.player_id
           LEFT JOIN (
             SELECT actor_player_id AS player_id, COUNT(*) AS timesActor FROM rounds
             WHERE game_id = ? AND actor_player_id IS NOT NULL GROUP BY actor_player_id
           ) r ON r.player_id = p.player_id`,
        )
        .all(gameId, gameId, gameId, gameId, gameId) as unknown as ScoreRow[];
    },
    totalsForRound(roundId: string): Array<{ playerId: string; points: number }> {
      return db
        .prepare(
          'SELECT player_id AS playerId, SUM(points) AS points FROM scores WHERE round_id = ? GROUP BY player_id',
        )
        .all(roundId) as unknown as Array<{ playerId: string; points: number }>;
    },
  };

  const activityImports = {
    create(row: {
      id: string;
      userId: string;
      scope: string;
      categoriesJson: string;
      tiktokRequestId: string | null;
      status: string;
      dataFormat: string;
      now: string;
    }): void {
      db.prepare(
        `INSERT INTO activity_imports (
           id, user_id, provider, scope, categories_json, tiktok_request_id, status, data_format,
           requested_at, last_checked_at, ready_at, expires_at, archive_path, skipped_count,
           error_code, error_message, created_at, updated_at
         ) VALUES (?, ?, 'tiktok', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, NULL, NULL, ?, ?)`,
      ).run(
        row.id,
        row.userId,
        row.scope,
        row.categoriesJson,
        row.tiktokRequestId,
        row.status,
        row.dataFormat,
        row.now,
        row.now,
        row.now,
      );
    },
    getById(id: string): ActivityImportRow | null {
      const row = db
        .prepare(`SELECT ${ACTIVITY_IMPORT_COLUMNS} FROM activity_imports WHERE id = ?`)
        .get(id);
      return (row as ActivityImportRow | undefined) ?? null;
    },
    getLatestForUser(userId: string): ActivityImportRow | null {
      const row = db
        .prepare(
          `SELECT ${ACTIVITY_IMPORT_COLUMNS} FROM activity_imports WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(userId);
      return (row as ActivityImportRow | undefined) ?? null;
    },
    getActiveForUser(userId: string): ActivityImportRow | null {
      const row = db
        .prepare(
          `SELECT ${ACTIVITY_IMPORT_COLUMNS} FROM activity_imports
           WHERE user_id = ? AND status IN ('requesting','pending','importing')
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(userId);
      return (row as ActivityImportRow | undefined) ?? null;
    },
    listActive(): ActivityImportRow[] {
      return db
        .prepare(
          `SELECT ${ACTIVITY_IMPORT_COLUMNS} FROM activity_imports
           WHERE status IN ('requesting','pending','importing') ORDER BY updated_at ASC`,
        )
        .all() as unknown as ActivityImportRow[];
    },
    listForUser(userId: string): ActivityImportRow[] {
      return db
        .prepare(
          `SELECT ${ACTIVITY_IMPORT_COLUMNS} FROM activity_imports WHERE user_id = ? ORDER BY created_at DESC`,
        )
        .all(userId) as unknown as ActivityImportRow[];
    },
    update(
      id: string,
      patch: {
        status?: string;
        tiktokRequestId?: string | null;
        lastCheckedAt?: string | null;
        readyAt?: string | null;
        expiresAt?: string | null;
        archivePath?: string | null;
        skippedCount?: number;
        errorCode?: string | null;
        errorMessage?: string | null;
        now: string;
      },
    ): void {
      const sets: string[] = ['updated_at = ?'];
      const params: unknown[] = [patch.now];
      for (const [column, value] of [
        ['status', patch.status],
        ['tiktok_request_id', patch.tiktokRequestId],
        ['last_checked_at', patch.lastCheckedAt],
        ['ready_at', patch.readyAt],
        ['expires_at', patch.expiresAt],
        ['archive_path', patch.archivePath],
        ['skipped_count', patch.skippedCount],
        ['error_code', patch.errorCode],
        ['error_message', patch.errorMessage],
      ] as const) {
        if (value !== undefined) {
          sets.push(`${column} = ?`);
          params.push(value);
        }
      }
      params.push(id);
      db.prepare(`UPDATE activity_imports SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    },
    deleteForUser(userId: string): number {
      return db.prepare('DELETE FROM activity_imports WHERE user_id = ?').run(userId).changes;
    },
  };

  const socialActions = {
    /** Inserts new actions, silently skipping ones we already stored (dedupe). */
    insertMany(
      rows: Array<{
        id: string;
        userId: string;
        provider: string;
        kind: string;
        contentId: string;
        contentUrl: string;
        occurredAt: string | null;
        now: string;
      }>,
    ): number {
      if (rows.length === 0) return 0;
      return db.transaction(() => {
        let inserted = 0;
        const statement = db.prepare(
          `INSERT OR IGNORE INTO social_actions (
             id, user_id, provider, kind, content_id, content_url, occurred_at,
             title, author_name, cover_url, enrichment_status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'pending', ?)`,
        );
        for (const row of rows) {
          inserted += statement.run(
            row.id,
            row.userId,
            row.provider,
            row.kind,
            row.contentId,
            row.contentUrl,
            row.occurredAt,
            row.now,
          ).changes;
        }
        return inserted;
      });
    },
    listForUser(userId: string, limit = 2000): SocialActionRow[] {
      return db
        .prepare(
          `SELECT ${SOCIAL_ACTION_COLUMNS} FROM social_actions WHERE user_id = ?
           ORDER BY occurred_at IS NULL, occurred_at DESC LIMIT ?`,
        )
        .all(userId, limit) as unknown as SocialActionRow[];
    },
    listByKind(userId: string, kind: string, limit = 2000): SocialActionRow[] {
      return db
        .prepare(
          `SELECT ${SOCIAL_ACTION_COLUMNS} FROM social_actions WHERE user_id = ? AND kind = ?
           ORDER BY occurred_at IS NULL, occurred_at DESC LIMIT ?`,
        )
        .all(userId, kind, limit) as unknown as SocialActionRow[];
    },
    countsForUser(userId: string): { like: number; save: number; repost: number } {
      const rows = db
        .prepare(
          'SELECT kind, COUNT(*) AS count FROM social_actions WHERE user_id = ? GROUP BY kind',
        )
        .all(userId) as unknown as Array<{ kind: string; count: number }>;
      const counts = { like: 0, save: 0, repost: 0 };
      for (const row of rows) {
        if (row.kind === 'like' || row.kind === 'save' || row.kind === 'repost') {
          counts[row.kind] = Number(row.count);
        }
      }
      return counts;
    },
    listPendingEnrichment(userId: string, limit: number): SocialActionRow[] {
      return db
        .prepare(
          `SELECT ${SOCIAL_ACTION_COLUMNS} FROM social_actions
           WHERE user_id = ? AND enrichment_status = 'pending'
           ORDER BY occurred_at IS NULL, occurred_at DESC LIMIT ?`,
        )
        .all(userId, limit) as unknown as SocialActionRow[];
    },
    updateEnrichment(
      id: string,
      patch: {
        title?: string | null;
        authorName?: string | null;
        coverUrl?: string | null;
        status: string;
      },
    ): void {
      db.prepare(
        `UPDATE social_actions SET enrichment_status = ?, title = COALESCE(?, title),
           author_name = COALESCE(?, author_name), cover_url = COALESCE(?, cover_url)
         WHERE id = ?`,
      ).run(patch.status, patch.title ?? null, patch.authorName ?? null, patch.coverUrl ?? null, id);
    },
    deleteForUser(userId: string): number {
      return db.prepare('DELETE FROM social_actions WHERE user_id = ?').run(userId).changes;
    },
  };

  return {
    users,
    sessions,
    oauthStates,
    oauthAccounts,
    rooms,
    players,
    games,
    rounds,
    roundActions,
    guesses,
    scores,
    activityImports,
    socialActions,
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
