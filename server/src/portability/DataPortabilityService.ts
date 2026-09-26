import fs from 'node:fs';
import path from 'node:path';
import { ERROR_MESSAGES, type ActivityImportState } from '@cluecrew/shared';
import { obtainAccessToken } from '../auth/accessToken.js';
import {
  DP_SUPPORTED_SCOPES,
  isPortabilityScopeGranted,
  type ServerConfig,
} from '../config.js';
import { decryptString, encryptString } from '../lib/crypto.js';
import type { ActivityImportRow, OauthAccountRow, Repositories } from '../database/repositories.js';
import { AppError, toAppError } from '../lib/errors.js';
import { appEvents } from '../lib/events.js';
import { randomId } from '../lib/ids.js';
import { createLogger, type Logger } from '../lib/logger.js';
import { ProviderAuthError, ProviderRateLimitError, ProviderScopeMissingError } from '../providers/types.js';
import { parseExportArchive } from './exportParser.js';
import { toPublicImportStatus, type DataPortabilityClient, type OEmbedClient } from './types.js';

const DOWNLOAD_WINDOW_MS = 4 * 24 * 60 * 60 * 1000; // TikTok keeps exports for 4 days
const REIMPORT_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // refresh data older than a week
const ORPHAN_FILE_AGE_MS = 60 * 60 * 1000;

export interface DataPortabilityServiceOptions {
  config: ServerConfig;
  repos: Repositories;
  client: DataPortabilityClient;
  oEmbed?: OEmbedClient | null;
  logger?: Logger;
  now?: () => number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitScopes(scopes: string): string[] {
  return scopes
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

/**
 * Owns the TikTok Data Portability import lifecycle:
 * request -> poll -> download -> parse -> normalize -> (temp files deleted).
 *
 * The raw export archive is never persisted: it exists only as a temp ZIP
 * until parsing finished, then it is removed in a `finally` block.
 */
export class DataPortabilityService {
  private readonly config: ServerConfig;
  private readonly repos: Repositories;
  private readonly client: DataPortabilityClient;
  private readonly oEmbed: OEmbedClient | null;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly enriching = new Set<string>();

  constructor(options: DataPortabilityServiceOptions) {
    this.config = options.config;
    this.repos = options.repos;
    this.client = options.client;
    this.oEmbed = options.oEmbed ?? null;
    this.logger = options.logger ?? createLogger('portability');
    this.now = options.now ?? (() => Date.now());
  }

  get enabled(): boolean {
    return this.config.dataPortability.enabled;
  }

  isScopeGranted(userId: string): boolean {
    const account = this.repos.oauthAccounts.getForUser(userId, 'tiktok');
    if (!account) return false;
    return isPortabilityScopeGranted(splitScopes(account.scopes));
  }

  // -------------------------------------------------------------------------
  // Public state
  // -------------------------------------------------------------------------

  getState(userId: string): ActivityImportState {
    const counts = { ...this.repos.socialActions.countsForUser(userId), post: 0 };
    const scopeGranted = this.isScopeGranted(userId);
    const row = this.repos.activityImports.getLatestForUser(userId);

    const state: ActivityImportState = {
      enabled: this.enabled,
      scopeGranted,
      scope: this.config.dataPortability.scope,
      status: row ? toPublicImportStatus(row.status) : 'none',
      requestedAt: null,
      lastCheckedAt: null,
      readyAt: null,
      expiresAt: null,
      counts,
      skipped: 0,
      error: null,
      note: null,
    };

    if (!row) {
      if (counts.like + counts.save + counts.repost > 0) {
        state.status = 'ready';
      }
      state.note = this.composeNote(state);
      return state;
    }

    state.requestedAt = Date.parse(row.requestedAt);
    state.lastCheckedAt = row.lastCheckedAt ? Date.parse(row.lastCheckedAt) : null;
    state.readyAt = row.readyAt ? Date.parse(row.readyAt) : null;
    state.expiresAt = row.expiresAt ? Date.parse(row.expiresAt) : null;
    state.skipped = row.skippedCount;
    if (row.errorCode || row.errorMessage) {
      state.error = {
        code: row.errorCode ?? 'TIKTOK_DP_EXPORT_FAILED',
        message: row.errorMessage ?? ERROR_MESSAGES.TIKTOK_DP_EXPORT_FAILED,
      };
    }
    state.note = this.composeNote(state);
    return state;
  }

  private composeNote(state: ActivityImportState): string | null {
    if (!this.enabled) {
      return 'TikTok activity import is currently unavailable for this application. TikTok requires a separate Data Portability API approval (3-4 weeks) on top of Login Kit approval.';
    }
    if (!state.scopeGranted) {
      return 'Reconnect TikTok and accept the data portability permission to import your activity.';
    }
    const categories = this.config.dataPortability.categories;
    if (!categories.includes('all_data')) {
      return `The "${categories.join(', ')}" export does not include liked or favourite videos — TikTok only provides those in the full data archive (all-data scope). Liked/saved modes stay on demo data until the app is approved for the all-data scope.`;
    }
    if (state.status === 'pending') {
      return 'TikTok is preparing your data. This can take seconds, minutes or hours — TikTok decides. You can leave this screen open; it updates automatically.';
    }
    if (state.status === 'importing') {
      return 'Downloading and importing your activity. The export is processed locally and deleted right away.';
    }
    if (state.status === 'ready' && state.counts.like + state.counts.save + state.counts.repost === 0) {
      return 'Your export contains no liked or favourite videos. That can happen if the account has none, or if the TikTok user is outside the EEA/UK, where TikTok only provides this data.';
    }
    if (state.status === 'expired') {
      return 'The prepared export expired (TikTok keeps exports downloadable for 4 days). Request a new one.';
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private requireAccount(userId: string): OauthAccountRow {
    const account = this.repos.oauthAccounts.getForUser(userId, 'tiktok');
    if (!account) throw new AppError('TIKTOK_AUTH_FAILED', { message: 'Connect TikTok first.' });
    return account;
  }

  private async accessTokenFor(account: OauthAccountRow): Promise<string> {
    const result = await obtainAccessToken({
      accessToken: account.accessTokenEnc
        ? decryptString(account.accessTokenEnc, this.config.tokenEncryptionKey)
        : null,
      refreshToken: account.refreshTokenEnc
        ? decryptString(account.refreshTokenEnc, this.config.tokenEncryptionKey)
        : null,
      accessTokenExpiresAt: account.accessTokenExpiresAt
        ? Date.parse(account.accessTokenExpiresAt)
        : null,
      refreshTokenExpiresAt: account.refreshTokenExpiresAt
        ? Date.parse(account.refreshTokenExpiresAt)
        : null,
      scopes: splitScopes(account.scopes),
      config: this.config.tiktok,
      now: this.now,
    });
    if (result.refreshed) {
      this.repos.oauthAccounts.updateTokens(account.id, {
        accessTokenEnc: encryptString(result.refreshed.accessToken, this.config.tokenEncryptionKey),
        refreshTokenEnc: result.refreshed.refreshToken
          ? encryptString(result.refreshed.refreshToken, this.config.tokenEncryptionKey)
          : null,
        accessTokenExpiresAt: new Date(result.refreshed.accessTokenExpiresAt).toISOString(),
        refreshTokenExpiresAt: result.refreshed.refreshTokenExpiresAt
          ? new Date(result.refreshed.refreshTokenExpiresAt).toISOString()
          : null,
        scopes: result.refreshed.scopes.join(','),
        now: new Date(this.now()).toISOString(),
      });
    }
    return result.accessToken;
  }

  /** Called right after a TikTok authorization when a portability scope was granted. */
  async ensureStarted(userId: string): Promise<ActivityImportState> {
    if (!this.enabled || !this.isScopeGranted(userId)) return this.getState(userId);

    const active = this.repos.activityImports.getActiveForUser(userId);
    if (active) return this.getState(userId);

    const latest = this.repos.activityImports.getLatestForUser(userId);
    const counts = this.repos.socialActions.countsForUser(userId);
    const hasData = counts.like + counts.save + counts.repost > 0;
    if (latest && latest.status === 'ready' && hasData) {
      const readyAt = latest.readyAt ? Date.parse(latest.readyAt) : 0;
      if (this.now() - readyAt < REIMPORT_AFTER_MS) return this.getState(userId);
    }

    try {
      return await this.startImport(userId);
    } catch (error) {
      this.logger.warn('Could not start TikTok activity import automatically', {
        userId,
        code: error instanceof AppError ? error.code : 'INTERNAL',
        message: error instanceof Error ? error.message : String(error),
      });
      return this.getState(userId);
    }
  }

  async startImport(userId: string): Promise<ActivityImportState> {
    if (!this.enabled) throw new AppError('TIKTOK_DP_NOT_ENABLED');
    const account = this.requireAccount(userId);
    const scopes = splitScopes(account.scopes);
    if (!isPortabilityScopeGranted(scopes)) throw new AppError('TIKTOK_DP_SCOPE_MISSING');
    if ((DP_SUPPORTED_SCOPES as readonly string[]).includes(this.config.dataPortability.scope) === false) {
      throw new AppError('TIKTOK_DP_NOT_ENABLED');
    }

    const active = this.repos.activityImports.getActiveForUser(userId);
    if (active) return this.getState(userId);

    const accessToken = await this.accessTokenFor(account);
    let requestId: string;
    try {
      const result = await this.client.addDataRequest({
        accessToken,
        categories: this.config.dataPortability.categories,
        dataFormat: 'json',
      });
      requestId = result.requestId;
    } catch (error) {
      const appError = toAppError(error);
      if (
        appError instanceof ProviderAuthError ||
        appError instanceof ProviderScopeMissingError ||
        appError instanceof ProviderRateLimitError
      ) {
        throw appError;
      }
      throw new AppError('TIKTOK_DP_REQUEST_FAILED', { message: appError.message });
    }

    const nowIso = new Date(this.now()).toISOString();
    this.repos.activityImports.create({
      id: randomId('imp', 10),
      userId,
      scope: this.config.dataPortability.scope,
      categoriesJson: JSON.stringify(this.config.dataPortability.categories),
      tiktokRequestId: requestId,
      status: 'pending',
      dataFormat: 'json',
      now: nowIso,
    });
    this.logger.info('TikTok activity export requested', {
      userId,
      requestId,
      categories: this.config.dataPortability.categories,
    });
    this.emitUpdated(userId);
    return this.getState(userId);
  }

  async refresh(userId: string, options: { force?: boolean } = {}): Promise<ActivityImportState> {
    if (!this.enabled) return this.getState(userId);

    const active = this.repos.activityImports.getActiveForUser(userId);
    const row = active ?? this.repos.activityImports.getLatestForUser(userId);
    if (!row || !row.tiktokRequestId) return this.getState(userId);
    if (row.status === 'importing') return this.getState(userId);
    if (row.status === 'requesting') {
      // The request was persisted but TikTok had not confirmed it yet.
      this.repos.activityImports.update(row.id, {
        status: 'pending',
        now: new Date(this.now()).toISOString(),
      });
    }
    if (!active && !options.force) return this.getState(userId);
    if (
      !options.force &&
      row.lastCheckedAt &&
      this.now() - Date.parse(row.lastCheckedAt) < this.config.dataPortability.pollIntervalMs
    ) {
      return this.getState(userId);
    }

    const account = this.repos.oauthAccounts.getForUser(userId, 'tiktok');
    if (!account) return this.getState(userId);

    let accessToken: string;
    try {
      accessToken = await this.accessTokenFor(account);
    } catch (error) {
      this.recordError(row, error);
      this.emitUpdated(userId);
      return this.getState(userId);
    }

    let status;
    try {
      status = await this.client.checkStatus({ accessToken, requestId: row.tiktokRequestId });
    } catch (error) {
      this.recordError(row, error);
      this.emitUpdated(userId);
      return this.getState(userId);
    }

    const nowIso = new Date(this.now()).toISOString();
    const statusBefore = row.status;
    switch (status.status) {
      case 'downloading':
        await this.importExport(row, accessToken);
        break;
      case 'pending':
        this.repos.activityImports.update(row.id, {
          status: 'pending',
          lastCheckedAt: nowIso,
          errorCode: null,
          errorMessage: null,
          now: nowIso,
        });
        break;
      case 'expired':
        this.repos.activityImports.update(row.id, {
          status: 'expired',
          lastCheckedAt: nowIso,
          errorCode: 'TIKTOK_DP_EXPORT_EXPIRED',
          errorMessage: ERROR_MESSAGES.TIKTOK_DP_EXPORT_EXPIRED,
          now: nowIso,
        });
        break;
      case 'cancelled':
        this.repos.activityImports.update(row.id, {
          status: 'cancelled',
          lastCheckedAt: nowIso,
          errorCode: 'TIKTOK_DP_EXPORT_FAILED',
          errorMessage: 'The TikTok export request was cancelled.',
          now: nowIso,
        });
        break;
      default:
        // Unknown status: keep waiting rather than pretending something happened.
        this.repos.activityImports.update(row.id, {
          status: 'pending',
          lastCheckedAt: nowIso,
          now: nowIso,
        });
        break;
    }

    // Only notify listeners when the public state actually changed, so polling
    // every couple of minutes does not spam the lobby.
    const after = this.repos.activityImports.getById(row.id);
    if (!after || after.status !== statusBefore) {
      this.emitUpdated(userId);
    }
    return this.getState(userId);
  }

  private recordError(row: ActivityImportRow, error: unknown): void {
    const appError = toAppError(error, 'TIKTOK_DP_EXPORT_FAILED');
    const definitive =
      appError instanceof ProviderAuthError ||
      appError instanceof ProviderScopeMissingError ||
      appError.code === 'TIKTOK_DP_PARSE_FAILED' ||
      appError.code === 'TIKTOK_DP_EXPORT_FAILED';
    const nowIso = new Date(this.now()).toISOString();
    this.repos.activityImports.update(row.id, {
      status: definitive ? 'failed' : row.status,
      lastCheckedAt: nowIso,
      errorCode: appError.code,
      errorMessage: appError.message,
      now: nowIso,
    });
    this.logger.warn('TikTok activity refresh failed', {
      userId: row.userId,
      code: appError.code,
      message: appError.message,
      definitive,
    });
  }

  private async importExport(row: ActivityImportRow, accessToken: string): Promise<void> {
    const nowIso = new Date(this.now()).toISOString();
    this.repos.activityImports.update(row.id, { status: 'importing', now: nowIso });
    this.emitUpdated(row.userId);

    fs.mkdirSync(this.config.dataPortability.importDir, { recursive: true });
    const archivePath = path.join(this.config.dataPortability.importDir, `${row.id}.zip`);
    this.repos.activityImports.update(row.id, { archivePath, now: nowIso });

    try {
      await this.client.downloadArchive({
        accessToken,
        requestId: row.tiktokRequestId ?? '',
        destinationPath: archivePath,
        maxBytes: this.config.dataPortability.maxDownloadBytes,
      });

      const buffer = fs.readFileSync(archivePath);
      const parsed = parseExportArchive(new Uint8Array(buffer), {
        maxActions: this.config.dataPortability.maxActions,
        maxTotalBytes: this.config.dataPortability.maxDownloadBytes * 2,
      });

      const capped = parsed.actions.slice(0, this.config.dataPortability.maxActions);
      const inserted = this.repos.socialActions.insertMany(
        capped.map((action) => ({
          id: randomId('sa', 10),
          userId: row.userId,
          provider: 'data_portability',
          kind: action.kind,
          contentId: action.contentId,
          contentUrl: action.contentUrl,
          occurredAt: action.occurredAt ? new Date(action.occurredAt).toISOString() : null,
          now: nowIso,
        })),
      );

      const skippedTotal =
        parsed.skipped + parsed.duplicates + Math.max(0, parsed.actions.length - capped.length);
      const readyIso = new Date(this.now()).toISOString();
      this.repos.activityImports.update(row.id, {
        status: 'ready',
        readyAt: readyIso,
        lastCheckedAt: readyIso,
        expiresAt: new Date(this.now() + DOWNLOAD_WINDOW_MS).toISOString(),
        archivePath: null,
        skippedCount: skippedTotal,
        errorCode: null,
        errorMessage: null,
        now: readyIso,
      });

      this.logger.info('TikTok activity imported', {
        userId: row.userId,
        inserted,
        skipped: skippedTotal,
        sections: parsed.sectionsFound,
        files: parsed.filesScanned,
      });

      void this.enrichPending(row.userId);
    } catch (error) {
      const appError = toAppError(error, 'TIKTOK_DP_EXPORT_FAILED');
      const failedIso = new Date(this.now()).toISOString();
      this.repos.activityImports.update(row.id, {
        status: 'failed',
        lastCheckedAt: failedIso,
        archivePath: null,
        errorCode: appError.code,
        errorMessage: appError.message,
        now: failedIso,
      });
      this.logger.warn('TikTok activity import failed', {
        userId: row.userId,
        code: appError.code,
        message: appError.message,
      });
    } finally {
      // Privacy: the raw export never outlives processing.
      try {
        fs.rmSync(archivePath, { force: true });
      } catch {
        // Non-fatal.
      }
    }
  }

  /** Deletes every imported action, import record and temp file for a user. */
  deleteImport(userId: string): void {
    for (const row of this.repos.activityImports.listForUser(userId)) {
      if (row.archivePath) {
        try {
          fs.rmSync(row.archivePath, { force: true });
        } catch {
          // Non-fatal.
        }
      }
    }
    const actions = this.repos.socialActions.deleteForUser(userId);
    const imports = this.repos.activityImports.deleteForUser(userId);
    this.logger.info('TikTok imported data deleted', { userId, actions, imports });
    this.emitUpdated(userId);
  }

  // -------------------------------------------------------------------------
  // Background work
  // -------------------------------------------------------------------------

  async pollActiveImports(): Promise<void> {
    if (!this.enabled) return;
    for (const row of this.repos.activityImports.listActive()) {
      try {
        await this.refresh(row.userId);
      } catch (error) {
        this.logger.warn('Polling TikTok activity import failed', {
          userId: row.userId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Removes orphaned temp ZIPs (e.g. after a crash mid-import). */
  cleanupTempFiles(): void {
    const dir = this.config.dataPortability.importDir;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.zip')) continue;
      const filePath = path.join(dir, entry);
      try {
        const stats = fs.statSync(filePath);
        if (this.now() - stats.mtimeMs > ORPHAN_FILE_AGE_MS) fs.rmSync(filePath, { force: true });
      } catch {
        // Non-fatal.
      }
    }
  }

  /**
   * Best-effort display metadata (title/creator/cover) via TikTok's public
   * oEmbed endpoint. Never required for the game to work.
   */
  async enrichPending(userId: string, limit?: number): Promise<number> {
    if (this.enriching.has(userId)) return 0;
    this.enriching.add(userId);
    try {
      const cfg = this.config.dataPortability;
      const rows = this.repos.socialActions.listPendingEnrichment(
        userId,
        limit ?? cfg.oEmbedLimit,
      );
      if (!this.oEmbed || !cfg.enrichWithOEmbed) {
        for (const row of rows) {
          this.repos.socialActions.updateEnrichment(row.id, { status: 'skipped' });
        }
        return 0;
      }
      let enriched = 0;
      for (const row of rows) {
        try {
          const metadata = await this.oEmbed.fetchMetadata(row.contentUrl);
          if (metadata) {
            this.repos.socialActions.updateEnrichment(row.id, {
              title: metadata.title,
              authorName: metadata.authorName,
              coverUrl: metadata.coverUrl,
              status: 'done',
            });
            enriched += 1;
          } else {
            this.repos.socialActions.updateEnrichment(row.id, { status: 'failed' });
          }
        } catch {
          this.repos.socialActions.updateEnrichment(row.id, { status: 'failed' });
        }
        await sleep(120);
      }
      if (enriched > 0) this.emitUpdated(userId);
      return enriched;
    } finally {
      this.enriching.delete(userId);
    }
  }

  private emitUpdated(userId: string): void {
    appEvents.emit('tiktok:import:updated', { userId });
  }
}
