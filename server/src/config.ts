import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { BRAND } from '@cluecrew/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works both from src/ (dev) and dist/ (bundled production build).
const repoRoot = path.resolve(here, '../..');
dotenv.config({ path: [path.resolve(repoRoot, '.env'), path.resolve(repoRoot, 'server/.env')] });

export interface GameTimings {
  introMs: number;
  contentMs: number;
  lockMs: number;
  revealMs: number;
  pointsMs: number;
}

export interface TikTokConfig {
  configured: boolean;
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

/** TikTok Data Portability (activity export import) settings. */
export interface DataPortabilityConfig {
  /** Master switch: only enable after TikTok approved the app for portability scopes. */
  enabled: boolean;
  /** Scope requested during Login Kit authorization. */
  scope: string;
  /** Categories sent to /v2/user/data/add/ (derived from the scope). */
  categories: string[];
  /** Temporary directory for downloaded export ZIPs (deleted after processing). */
  importDir: string;
  /** How often pending exports are polled server-side. */
  pollIntervalMs: number;
  /** Hard cap on stored social actions per user. */
  maxActions: number;
  /** Hard cap on the exported ZIP size. */
  maxDownloadBytes: number;
  /** Best-effort display metadata enrichment via TikTok's public oEmbed endpoint. */
  enrichWithOEmbed: boolean;
  /** Max number of actions enriched per import. */
  oEmbedLimit: number;
}

export const DP_SUPPORTED_SCOPES = [
  'portability.all.ongoing',
  'portability.all.single',
  'portability.activity.ongoing',
  'portability.activity.single',
  'portability.postsandprofile.ongoing',
  'portability.postsandprofile.single',
] as const;

export function categoriesForPortabilityScope(scope: string): string[] {
  if (scope.startsWith('portability.all.') || scope === 'portability.all') return ['all_data'];
  if (scope.startsWith('portability.activity.')) return ['activity'];
  if (scope.startsWith('portability.postsandprofile.')) return ['video', 'profile'];
  return [];
}

export function isPortabilityScopeGranted(scopes: string[]): boolean {
  return scopes.some((scope) => scope.startsWith('portability.'));
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export interface ServerConfig {
  nodeEnv: string;
  isProduction: boolean;
  isTest: boolean;
  appVersion: string;
  port: number;
  publicUrl: string;
  clientUrl: string;
  allowedOrigins: string[];
  /** 'None' (plus Secure) is required when frontend and backend are different sites. */
  cookieSameSite: 'Lax' | 'None';
  repoRoot: string;
  clientDistPath: string;
  serveClient: boolean;

  databasePath: string;
  roomTtlMs: number;
  sessionTtlMs: number;

  tokenEncryptionKey: Buffer;
  allowMockProvider: boolean;
  maxPlayersPerRoom: number;
  hostTransferGraceMs: number;
  roomIdleTimeoutMs: number;

  tiktok: TikTokConfig;
  dataPortability: DataPortabilityConfig;
  timings: GameTimings;
}

export interface ConfigOverrides {
  nodeEnv?: string;
  appVersion?: string;
  port?: number;
  publicUrl?: string;
  clientUrl?: string;
  allowedOrigins?: string[];
  cookieSameSite?: 'Lax' | 'None';
  databasePath?: string;
  serveClient?: boolean;
  allowMockProvider?: boolean;
  maxPlayersPerRoom?: number;
  hostTransferGraceMs?: number;
  roomIdleTimeoutMs?: number;
  tokenEncryptionKey?: Buffer;
  tiktok?: Partial<TikTokConfig>;
  dataPortability?: Partial<DataPortabilityConfig>;
  timings?: Partial<GameTimings>;
}

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

/** First non-empty value among several accepted env names (alias support). */
function envFirst(names: string[], fallback: string): string {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function parseEncryptionKey(raw: string): Buffer | null {
  const cleaned = raw.trim();
  if (cleaned.length === 0) return null;
  const buffer = Buffer.from(cleaned, 'hex');
  return buffer.length === 32 ? buffer : null;
}

let warnedAboutDevKey = false;

export function loadConfig(overrides: ConfigOverrides = {}): ServerConfig {
  const nodeEnv = overrides.nodeEnv ?? envString('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test' || Boolean(process.env.VITEST);
  const port = overrides.port ?? envInt('PORT', 3001);
  // Render (and similar platforms) inject the assigned public URL at runtime,
  // which makes a Blueprint deploy fully zero-config: explicit env vars win,
  // otherwise the platform URL is used, otherwise local defaults apply.
  const platformUrl = envString('RENDER_EXTERNAL_URL', '').replace(/\/$/, '');
  const publicUrl = (
    overrides.publicUrl ??
    envFirst(['BACKEND_URL', 'PUBLIC_URL'], platformUrl || `http://localhost:${port}`)
  ).replace(/\/$/, '');
  const clientUrl = (
    overrides.clientUrl ??
    envFirst(['FRONTEND_URL', 'CLIENT_URL'], platformUrl || 'http://localhost:5173')
  ).replace(/\/$/, '');
  const allowedOrigins =
    overrides.allowedOrigins ??
    envString('ALLOWED_ORIGINS', `${clientUrl},${publicUrl}`)
      .split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean);

  const databasePathRaw = (
    overrides.databasePath ??
    envFirst(['DATABASE_URL', 'DATABASE_PATH'], './data/cluecrew.sqlite')
  ).replace(/^file:\/?\/?/, '');
  if (/^postgres(ql)?:\/\//i.test(databasePathRaw)) {
    throw new Error(
      'DATABASE_URL points to PostgreSQL, which this build does not support yet. ' +
        'ClueCrew uses SQLite (set DATABASE_URL to a file path or use DATABASE_PATH). ' +
        'See docs/DEPLOYMENT.md for the free-hosting options.',
    );
  }
  const databasePath =
    databasePathRaw === ':memory:' || path.isAbsolute(databasePathRaw)
      ? databasePathRaw
      : path.resolve(repoRoot, databasePathRaw);

  let tokenEncryptionKey = overrides.tokenEncryptionKey;
  if (!tokenEncryptionKey) {
    const rawSecret = envFirst(['TOKEN_ENCRYPTION_KEY', 'SESSION_SECRET'], '');
    const parsed = parseEncryptionKey(rawSecret);
    if (parsed) {
      // 64 hex characters are used directly as the 32-byte AES key.
      tokenEncryptionKey = parsed;
    } else if (rawSecret.length > 0) {
      // Platform-generated secrets (e.g. Render's base64 generateValue) are not
      // hex; derive a stable 32-byte key with SHA-256 so tokens remain
      // decryptable across restarts.
      tokenEncryptionKey = crypto.createHash('sha256').update(rawSecret).digest();
      if (rawSecret.length < 32) {
        console.warn(
          '[config] TOKEN_ENCRYPTION_KEY/SESSION_SECRET is short — use at least 32 random characters.',
        );
      }
    } else if (isProduction) {
      throw new Error(
        'TOKEN_ENCRYPTION_KEY is required in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    } else {
      tokenEncryptionKey = crypto.createHash('sha256').update('cluecrew-development-key').digest();
      if (!warnedAboutDevKey && !isTest) {
        warnedAboutDevKey = true;
        console.warn(
          '[config] TOKEN_ENCRYPTION_KEY not set - using an insecure development key. Set it before deploying.',
        );
      }
    }
  }

  const tiktokClientKey = overrides.tiktok?.clientKey ?? envString('TIKTOK_CLIENT_KEY', '');
  const tiktokClientSecret = overrides.tiktok?.clientSecret ?? envString('TIKTOK_CLIENT_SECRET', '');

  const dataPortabilityScope =
    overrides.dataPortability?.scope ??
    envString('TIKTOK_DATAPORTABILITY_SCOPE', 'portability.all.ongoing');
  if (!(DP_SUPPORTED_SCOPES as readonly string[]).includes(dataPortabilityScope)) {
    throw new Error(
      `Unsupported TIKTOK_DATAPORTABILITY_SCOPE "${dataPortabilityScope}". Supported: ${DP_SUPPORTED_SCOPES.join(', ')}`,
    );
  }
  const dataPortabilityRequested =
    overrides.dataPortability?.enabled ?? envBool('TIKTOK_DATAPORTABILITY_ENABLED', false);

  const tiktokScopes = [
    ...(overrides.tiktok?.scopes ?? ['user.info.basic', 'video.list']),
  ];
  if (dataPortabilityRequested && !tiktokScopes.includes(dataPortabilityScope)) {
    tiktokScopes.push(dataPortabilityScope);
  }

  const tiktok: TikTokConfig = {
    configured: Boolean(tiktokClientKey && tiktokClientSecret),
    clientKey: tiktokClientKey,
    clientSecret: tiktokClientSecret,
    redirectUri:
      overrides.tiktok?.redirectUri ??
      envFirst(['TIKTOK_REDIRECT_URI'], `${publicUrl}/api/auth/tiktok/callback`),
    scopes: tiktokScopes,
  };

  const dataPortability: DataPortabilityConfig = {
    // Only meaningful with credentials: without them nothing can be requested.
    enabled: dataPortabilityRequested && tiktok.configured,
    scope: dataPortabilityScope,
    categories:
      overrides.dataPortability?.categories ??
      categoriesForPortabilityScope(dataPortabilityScope),
    importDir:
      overrides.dataPortability?.importDir ??
      path.resolve(repoRoot, envString('DP_IMPORT_DIR', './data/imports')),
    pollIntervalMs:
      overrides.dataPortability?.pollIntervalMs ??
      envInt('DP_POLL_INTERVAL_SECONDS', 120) * 1000,
    maxActions: overrides.dataPortability?.maxActions ?? envInt('DP_MAX_ACTIONS', 2000),
    maxDownloadBytes:
      overrides.dataPortability?.maxDownloadBytes ??
      envInt('DP_MAX_DOWNLOAD_MB', 100) * 1024 * 1024,
    enrichWithOEmbed:
      overrides.dataPortability?.enrichWithOEmbed ?? envBool('TIKTOK_OEMBED_ENRICH', true),
    oEmbedLimit: overrides.dataPortability?.oEmbedLimit ?? envInt('DP_OEMBED_LIMIT', 60),
  };

  const timings: GameTimings = {
    introMs: overrides.timings?.introMs ?? envInt('GAME_INTRO_MS', 2500),
    contentMs: overrides.timings?.contentMs ?? envInt('GAME_CONTENT_MS', 3000),
    lockMs: overrides.timings?.lockMs ?? envInt('GAME_LOCK_MS', 1200),
    revealMs: overrides.timings?.revealMs ?? envInt('GAME_REVEAL_MS', 5000),
    pointsMs: overrides.timings?.pointsMs ?? envInt('GAME_POINTS_MS', 7000),
  };

  return {
    nodeEnv,
    isProduction,
    isTest,
    appVersion: overrides.appVersion ?? envFirst(['APP_VERSION'], BRAND.version),
    port,
    publicUrl,
    clientUrl,
    allowedOrigins,
    cookieSameSite:
      overrides.cookieSameSite ??
      (isProduction && originOf(publicUrl) !== originOf(clientUrl) ? 'None' : 'Lax'),
    repoRoot,
    clientDistPath: path.resolve(repoRoot, 'client/dist'),
    serveClient: overrides.serveClient ?? (isProduction || envBool('SERVE_CLIENT', false)),
    databasePath,
    roomTtlMs: envInt('ROOM_TTL_HOURS', 12) * 60 * 60 * 1000,
    sessionTtlMs: envInt('SESSION_TTL_DAYS', 30) * 24 * 60 * 60 * 1000,
    tokenEncryptionKey,
    allowMockProvider: overrides.allowMockProvider ?? envBool('ALLOW_MOCK_PROVIDER', true),
    maxPlayersPerRoom: overrides.maxPlayersPerRoom ?? envInt('MAX_PLAYERS_PER_ROOM', 12),
    hostTransferGraceMs:
      overrides.hostTransferGraceMs ?? envInt('HOST_TRANSFER_GRACE_SECONDS', 30) * 1000,
    roomIdleTimeoutMs:
      overrides.roomIdleTimeoutMs ?? envInt('ROOM_IDLE_TIMEOUT_MINUTES', 180) * 60 * 1000,
    tiktok,
    dataPortability,
    timings,
  };
}
