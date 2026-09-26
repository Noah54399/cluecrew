export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_seed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  return_to TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scopes TEXT NOT NULL DEFAULT '',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, provider),
  UNIQUE(provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);

CREATE TABLE IF NOT EXISTS game_rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  host_player_id TEXT,
  settings_json TEXT NOT NULL,
  state_json TEXT,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_rooms_expires ON game_rooms(expires_at);
CREATE INDEX IF NOT EXISTS idx_game_rooms_status ON game_rooms(status);

CREATE TABLE IF NOT EXISTS game_players (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  avatar_seed INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT,
  reconnect_token_hash TEXT NOT NULL,
  is_host INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'none',
  joined_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_players_room ON game_players(room_id);
CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  round_count INTEGER NOT NULL DEFAULT 0,
  scoring_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_games_room ON games(room_id);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  mode TEXT NOT NULL,
  actor_player_id TEXT REFERENCES game_players(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rounds_game ON rounds(game_id);

CREATE TABLE IF NOT EXISTS round_actions (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_id TEXT NOT NULL,
  content_json TEXT NOT NULL,
  is_mock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_round_actions_round ON round_actions(round_id);

CREATE TABLE IF NOT EXISTS guesses (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES game_players(id) ON DELETE CASCADE,
  guessed_player_id TEXT REFERENCES game_players(id) ON DELETE SET NULL,
  submitted_at TEXT NOT NULL,
  is_correct INTEGER,
  points INTEGER,
  UNIQUE(round_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_guesses_round ON guesses(round_id);

CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES game_players(id) ON DELETE CASCADE,
  round_id TEXT REFERENCES rounds(id) ON DELETE SET NULL,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game_id);
CREATE INDEX IF NOT EXISTS idx_scores_round ON scores(round_id);

-- ---------------------------------------------------------------------------
-- TikTok Data Portability imports
-- ---------------------------------------------------------------------------

-- One row per data export request lifecycle. Raw export archives are NEVER
-- stored here: they are parsed from a temp file and deleted immediately.
CREATE TABLE IF NOT EXISTS activity_imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'tiktok',
  scope TEXT NOT NULL,
  categories_json TEXT NOT NULL,
  tiktok_request_id TEXT,
  -- requesting | pending | importing | ready | failed | expired | cancelled
  status TEXT NOT NULL,
  data_format TEXT NOT NULL DEFAULT 'json',
  requested_at TEXT NOT NULL,
  last_checked_at TEXT,
  ready_at TEXT,
  expires_at TEXT,
  archive_path TEXT,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_imports_user ON activity_imports(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_imports_status ON activity_imports(status);

-- Normalized, minimal game data extracted from an export:
-- only the video reference and its date, never the rest of the archive.
CREATE TABLE IF NOT EXISTS social_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,               -- like | save | repost
  content_id TEXT NOT NULL,
  content_url TEXT NOT NULL,
  occurred_at TEXT,
  title TEXT,
  author_name TEXT,
  cover_url TEXT,
  enrichment_status TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed | skipped
  created_at TEXT NOT NULL,
  UNIQUE(user_id, kind, content_id)
);
CREATE INDEX IF NOT EXISTS idx_social_actions_user ON social_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_social_actions_user_kind ON social_actions(user_id, kind);
`;
