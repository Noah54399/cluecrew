import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import type { ActivityImportState } from '@cluecrew/shared';
import { loadConfig, type ConfigOverrides } from '../src/config.js';
import { encryptString } from '../src/lib/crypto.js';
import { randomId } from '../src/lib/ids.js';
import type { OauthAccountRow, SocialActionRow } from '../src/database/repositories.js';
import { parseExportArchive } from '../src/portability/exportParser.js';
import { createSocialProvider } from '../src/providers/factory.js';
import { MockSocialProvider } from '../src/providers/mock/MockSocialProvider.js';
import { TikTokDataPortabilityProvider } from '../src/providers/tiktok/TikTokDataPortabilityProvider.js';
import {
  ProviderApiError,
  ProviderRateLimitError,
} from '../src/providers/types.js';
import { api, createTestContext, type TestContext } from './helpers.js';

const DP_CONFIG: ConfigOverrides = {
  tiktok: {
    clientKey: 'test-key',
    clientSecret: 'test-secret',
    scopes: ['user.info.basic', 'video.list', 'portability.all.ongoing'],
  },
  dataPortability: {
    enabled: true,
    scope: 'portability.all.ongoing',
  },
};

const ALL_SCOPES = ['user.info.basic', 'video.list', 'portability.all.ongoing'];

function createUser(ctx: TestContext) {
  return ctx.sessions.createUserWithSession({ displayName: 'Nova', avatarSeed: 0 });
}

function linkTiktok(ctx: TestContext, userId: string, scopes: string[]): void {
  const now = new Date().toISOString();
  ctx.repos.oauthAccounts.save({
    id: randomId('oa'),
    userId,
    provider: 'tiktok',
    providerUserId: 'open-42',
    displayName: 'Nova',
    avatarUrl: null,
    accessTokenEnc: encryptString('act-test-token', ctx.config.tokenEncryptionKey),
    refreshTokenEnc: encryptString('rft-test-token', ctx.config.tokenEncryptionKey),
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    scopes: scopes.join(','),
    capabilitiesJson: '{}',
    now,
  });
}

function buildZip(files: Record<string, unknown | string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = typeof content === 'string' ? strToU8(content) : strToU8(JSON.stringify(content));
  }
  return zipSync(entries);
}

const LIKED_A = 'https://www.tiktok.com/@someone/video/1111111111111111111';
const LIKED_B = 'https://www.tiktok.com/@someone/video/2222222222222222222';
const SAVED_A = 'https://www.tiktok.com/@someone/photo/4444444444444444444';
const WATCH_HISTORY = 'https://www.tiktok.com/@x/video/9999999999999999999';

/** Sample modeled on the documented Data Portability archive structure. */
function sampleExport(): Record<string, unknown> {
  return {
    'Likes and Favourites': {
      'Like List': [
        { Date: '2024-06-01 12:31:34', 'Video landing page link': LIKED_A },
        { Date: '2024-06-02 08:00:00', 'Video landing page link': LIKED_B },
        { Date: '2024-06-03 08:00:00' }, // missing URL -> skipped
        { Date: '2024-06-04 08:00:00', 'Video landing page link': 'https://example.com/video/333' },
      ],
      'Favourite Videos': [{ Date: '2024-05-01 10:00:00', 'Video landing page link': SAVED_A }],
    },
    'Your Activity': {
      'Watch History': [
        { Date: '2024-06-01', 'Video landing page link': WATCH_HISTORY, 'Post title': 'private' },
      ],
      Searches: [{ Date: '2024-06-01', 'Search Term': 'very private search' }],
      'Ad Interests': { 'Ad Interest Categories': ['private category'] },
    },
    'Direct Messages': {
      'Chat History': [{ Date: '2024-06-01', From: 'friend', Content: 'very private message' }],
    },
    Profile: {
      'Profile Information': { Nickname: 'Nova', 'Telephone Number': '+1234567890' },
    },
    Purchases: { 'Order History': [{ 'Order number': 'PRIVATE-ORDER' }] },
  };
}

async function readyStateWithExport(ctx: TestContext, userId: string) {
  ctx.dpClient.statuses = ['downloading'];
  ctx.dpClient.archiveProvider = () => buildZip({ 'user_data.json': sampleExport() });
  await ctx.dataPortability.startImport(userId);
  return ctx.dataPortability.refresh(userId, { force: true });
}

describe('TikTok Data Portability — authorization and requests', () => {
  it('is disabled unless the server has Data Portability approval configured', async () => {
    const ctx = await createTestContext();
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ALL_SCOPES);
      await expect(ctx.dataPortability.startImport(user.id)).rejects.toMatchObject({
        code: 'TIKTOK_DP_NOT_ENABLED',
      });
      const state = ctx.dataPortability.getState(user.id);
      expect(state.enabled).toBe(false);
      expect(state.note).toMatch(/unavailable for this application/i);
    } finally {
      await ctx.close();
    }
  });

  it('requires the account to have granted a portability scope', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ['user.info.basic', 'video.list']);
      expect(ctx.dataPortability.getState(user.id).scopeGranted).toBe(false);
      await expect(ctx.dataPortability.startImport(user.id)).rejects.toMatchObject({
        code: 'TIKTOK_DP_SCOPE_MISSING',
      });
    } finally {
      await ctx.close();
    }
  });

  it('creates exactly one export request with the configured categories', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ALL_SCOPES);
      ctx.dpClient.statuses = ['pending'];

      const state = await ctx.dataPortability.startImport(user.id);
      expect(ctx.dpClient.addCalls).toBe(1);
      expect(ctx.dpClient.lastCategories).toEqual(['all_data']);
      expect(state.status).toBe('pending');
      expect(state.requestedAt).toBeGreaterThan(0);

      // Idempotent while an export is active.
      await ctx.dataPortability.startImport(user.id);
      expect(ctx.dpClient.addCalls).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it('reports TikTok API failures clearly', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ALL_SCOPES);
      ctx.dpClient.addError = new ProviderRateLimitError('slow down');
      await expect(ctx.dataPortability.startImport(user.id)).rejects.toMatchObject({
        code: 'TIKTOK_RATE_LIMITED',
      });
    } finally {
      await ctx.close();
    }
  });
});

describe('TikTok Data Portability — import lifecycle', () => {
  it('downloads, imports and normalizes liked + saved videos, then deletes the archive', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ALL_SCOPES);
      const state = await readyStateWithExport(ctx, user.id);

      expect(state.status).toBe('ready');
      expect(state.counts.like).toBe(2);
      expect(state.counts.save).toBe(1);
      expect(state.counts.repost).toBe(0);
      expect(state.skipped).toBeGreaterThanOrEqual(2); // missing URL + non-TikTok host
      expect(state.expiresAt).toBeGreaterThan(Date.now());

      const rows = ctx.repos.socialActions.listForUser(user.id);
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.kind === 'like' || row.kind === 'save')).toBe(true);
      const liked = rows.find((row) => row.kind === 'like' && row.contentUrl === LIKED_A)!;
      expect(liked.contentId).toBe('1111111111111111111');
      expect(liked.occurredAt).toContain('2024-06-01');

      // Privacy: the raw export is deleted after processing.
      expect(fs.readdirSync(ctx.importDir)).toHaveLength(0);

      // Capabilities now report real data.
      const provider = new TikTokDataPortabilityProvider({
        providerUserId: 'open-42',
        displayName: 'Nova',
        avatarUrl: null,
        importState: state,
        actions: rows,
        displayProvider: null,
      });
      const capabilities = provider.getCapabilities();
      expect(capabilities.like.available).toBe(true);
      expect(capabilities.save.available).toBe(true);
      expect(capabilities.repost.available).toBe(false);
      const items = await provider.getAvailableLikedContent(10);
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ provider: 'tiktok', kind: 'like' });
    } finally {
      await ctx.close();
    }
  });

  it('never imports private data from other archive sections', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ALL_SCOPES);
      await readyStateWithExport(ctx, user.id);

      const rows = ctx.repos.socialActions.listForUser(user.id);
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain('very private');
      expect(serialized).not.toContain('PRIVATE-ORDER');
      expect(serialized).not.toContain('Telephone');
      expect(serialized).not.toContain('9999999999999999999'); // watch history stays out
      for (const row of rows) {
        expect(row.contentUrl).toMatch(/^https:\/\/(www\.)?tiktok\.com\//);
      }
    } finally {
      await ctx.close();
    }
  });

  it('deduplicates repeated activities', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ALL_SCOPES);
      ctx.dpClient.statuses = ['downloading'];
      ctx.dpClient.archiveProvider = () =>
        buildZip({
          'likes.json': {
            'Like List': [
              { Date: '2024-06-01', 'Video landing page link': LIKED_A },
              { Date: '2024-06-01', 'Video landing page link': LIKED_A },
            ],
          },
        });
      await ctx.dataPortability.startImport(user.id);
      const state = await ctx.dataPortability.refresh(user.id, { force: true });
      expect(state.counts.like).toBe(1);
      expect(state.skipped).toBeGreaterThanOrEqual(1);
      expect(ctx.repos.socialActions.countsForUser(user.id).like).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it('fails cleanly on a malformed export', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ALL_SCOPES);
      ctx.dpClient.statuses = ['downloading'];
      ctx.dpClient.archiveProvider = () => strToU8('this is definitely not a zip file');
      await ctx.dataPortability.startImport(user.id);
      const state = await ctx.dataPortability.refresh(user.id, { force: true });
      expect(state.status).toBe('failed');
      expect(state.error?.code).toBe('TIKTOK_DP_PARSE_FAILED');
      expect(ctx.repos.socialActions.countsForUser(user.id).like).toBe(0);
      expect(fs.readdirSync(ctx.importDir)).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  it('fails when every JSON file is invalid', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ALL_SCOPES);
      ctx.dpClient.statuses = ['downloading'];
      ctx.dpClient.archiveProvider = () => buildZip({ 'data.json': '{not valid json' });
      await ctx.dataPortability.startImport(user.id);
      const state = await ctx.dataPortability.refresh(user.id, { force: true });
      expect(state.status).toBe('failed');
      expect(state.error?.code).toBe('TIKTOK_DP_PARSE_FAILED');
    } finally {
      await ctx.close();
    }
  });

  it('marks expired exports with a clear message', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ALL_SCOPES);
      ctx.dpClient.statuses = ['expired'];
      await ctx.dataPortability.startImport(user.id);
      const state = await ctx.dataPortability.refresh(user.id, { force: true });
      expect(state.status).toBe('expired');
      expect(state.error?.code).toBe('TIKTOK_DP_EXPORT_EXPIRED');
      expect(state.note).toMatch(/4 days/i);
    } finally {
      await ctx.close();
    }
  });

  it('keeps waiting (rather than failing) on transient TikTok errors', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ALL_SCOPES);
      ctx.dpClient.statuses = ['pending'];
      await ctx.dataPortability.startImport(user.id);
      ctx.dpClient.checkError = new ProviderApiError('TikTok hiccup');
      const state = await ctx.dataPortability.refresh(user.id, { force: true });
      expect(state.status).toBe('pending');
      expect(state.error?.message).toMatch(/hiccup/);
    } finally {
      await ctx.close();
    }
  });

  it('fails the import when the download endpoint errors', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ALL_SCOPES);
      ctx.dpClient.statuses = ['downloading'];
      ctx.dpClient.downloadError = new ProviderApiError('download exploded');
      await ctx.dataPortability.startImport(user.id);
      const state = await ctx.dataPortability.refresh(user.id, { force: true });
      expect(state.status).toBe('failed');
      expect(state.error?.message).toMatch(/download exploded/);
    } finally {
      await ctx.close();
    }
  });

  it('deletes imported data on request (and on disconnect)', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      linkTiktok(ctx, user.id, ALL_SCOPES);
      await readyStateWithExport(ctx, user.id);
      expect(ctx.repos.socialActions.countsForUser(user.id).like).toBeGreaterThan(0);

      ctx.dataPortability.deleteImport(user.id);
      expect(ctx.repos.socialActions.countsForUser(user.id).like).toBe(0);
      expect(ctx.repos.activityImports.getLatestForUser(user.id)).toBeNull();
      expect(ctx.dataPortability.getState(user.id).status).toBe('none');

      // Disconnect also removes imports (privacy default).
      await readyStateWithExport(ctx, user.id);
      await ctx.oauth.disconnect(user.id);
      expect(ctx.repos.socialActions.countsForUser(user.id).like).toBe(0);
      expect(ctx.repos.oauthAccounts.getForUser(user.id, 'tiktok')).toBeNull();
    } finally {
      await ctx.close();
    }
  });

  it('exposes the import through the REST API with CSRF protection', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const guest = await api<{ csrfToken: string; user: { id: string } }>(
        ctx.baseUrl,
        '/api/session/guest',
        { body: { name: 'Nova' } },
      );
      const cookie = guest.setCookie!.split(';')[0]!;
      linkTiktok(ctx, guest.body.user.id, ALL_SCOPES);

      const status = await api<{ linked: boolean; enabled: boolean; scopeGranted: boolean }>(
        ctx.baseUrl,
        '/api/tiktok/import',
        { cookie },
      );
      expect(status.status).toBe(200);
      expect(status.body).toMatchObject({ linked: true, enabled: true, scopeGranted: true });

      const forbidden = await api(ctx.baseUrl, '/api/tiktok/import/request', {
        body: {},
        cookie,
      });
      expect(forbidden.status).toBe(403);

      const requested = await api<{ status: string }>(ctx.baseUrl, '/api/tiktok/import/request', {
        body: {},
        cookie,
        csrf: guest.body.csrfToken,
      });
      expect(requested.status).toBe(200);
      expect(requested.body.status).toBe('pending');
      expect(ctx.dpClient.addCalls).toBe(1);
    } finally {
      await ctx.close();
    }
  });
});

describe('export parser', () => {
  it('recognizes like/save sections by normalized names regardless of nesting', () => {
    const result = parseExportArchive(
      buildZip({
        'a.json': { data: { 'Like List': [{ Date: '2024-01-01', 'Video landing page link': LIKED_A }] } },
        'b.json': { 'Favourite Videos': [{ Date: '2024-01-02', 'Video landing page link': SAVED_A }] },
        Unrelated: { nested: { deeper: [{ random: 'x' }] } },
      }),
    );
    expect(result.actions.map((action) => action.kind).sort()).toEqual(['like', 'save']);
    expect(result.sectionsFound).toHaveLength(2);
  });

  it('ignores URLs that are not TikTok video links', () => {
    const result = parseExportArchive(
      buildZip({
        'a.json': {
          'Like List': [
            { Date: '2024-01-01', 'Video landing page link': 'https://example.com/video/1' },
            { Date: '2024-01-01', 'Video landing page link': 'https://vm.tiktok.com/ZM1234567/' },
            { Date: '2024-01-01', 'Video landing page link': 'https://www.tiktok.com/@a/video/1234567890123456789' },
          ],
        },
      }),
    );
    expect(result.actions).toHaveLength(1);
    expect(result.skipped).toBe(2);
  });

  it('parses text-format exports inside recognized sections only', () => {
    const text = [
      'Like List',
      'Date: 2024-06-01 12:00:00',
      `Video landing page link: ${LIKED_A}`,
      '',
      'Searches',
      'Date: 2024-06-01',
      'Search Term: https://www.tiktok.com/@x/video/7777777777777777777',
    ].join('\n');
    const result = parseExportArchive(buildZip({ 'user_data.txt': text }));
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.contentId).toBe('1111111111111111111');
  });
});

describe('provider abstraction with Data Portability data', () => {
  function makeAccount(ctx: TestContext, userId: string): OauthAccountRow {
    return {
      id: 'oa_test',
      userId,
      provider: 'tiktok',
      providerUserId: 'open-42',
      displayName: 'Nova',
      avatarUrl: null,
      accessTokenEnc: encryptString('act', ctx.config.tokenEncryptionKey),
      refreshTokenEnc: encryptString('rft', ctx.config.tokenEncryptionKey),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      scopes: ALL_SCOPES.join(','),
      capabilitiesJson: '{}',
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function makeAction(kind: string, contentId: string): SocialActionRow {
    return {
      id: randomId('sa'),
      userId: 'usr_test',
      provider: 'data_portability',
      kind,
      contentId,
      contentUrl: `https://www.tiktok.com/@a/video/${contentId}`,
      occurredAt: '2024-06-01T12:31:34.000Z',
      title: null,
      authorName: null,
      coverUrl: null,
      enrichmentStatus: 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  function importState(): ActivityImportState {
    return {
      enabled: true,
      scopeGranted: true,
      scope: 'portability.all.ongoing',
      status: 'ready',
      requestedAt: Date.now(),
      lastCheckedAt: Date.now(),
      readyAt: Date.now(),
      expiresAt: Date.now() + 86_400_000,
      counts: { like: 1, save: 0, repost: 0, post: 0 },
      skipped: 0,
      error: null,
      note: null,
    };
  }

  it('selects the Data Portability provider when the scope was granted', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      const provider = createSocialProvider({
        playerKey: 'p1',
        playerName: 'Nova',
        avatarSeed: 0,
        account: makeAccount(ctx, user.id),
        config: ctx.config,
        dataPortability: { state: importState(), actions: [makeAction('like', '123')] },
      });
      expect(provider).toBeInstanceOf(TikTokDataPortabilityProvider);
      expect(provider.getCapabilities().like.available).toBe(true);
      const items = await provider.getAvailableLikedContent(5);
      expect(items[0]!.webUrl).toContain('/video/123');
    } finally {
      await ctx.close();
    }
  });

  it('keeps the mock provider working (the development switch)', async () => {
    const ctx = await createTestContext({ ...DP_CONFIG });
    try {
      const { user } = createUser(ctx);
      const provider = createSocialProvider({
        playerKey: 'p1',
        playerName: 'Nova',
        avatarSeed: 0,
        account: makeAccount(ctx, user.id),
        config: ctx.config,
        preference: 'mock',
      });
      expect(provider).toBeInstanceOf(MockSocialProvider);
      const capabilities = provider.getCapabilities();
      expect(capabilities.like.available).toBe(true);
      expect(capabilities.like.reason).toMatch(/demo data/i);
      const items = await provider.getAvailableLikedContent(3);
      expect(items).toHaveLength(3);
    } finally {
      await ctx.close();
    }
  });

  it('serves nothing fake when the player insists on real data without a connection', () => {
    const config = loadConfig({
      tiktok: { clientKey: 'k', clientSecret: 's' },
      dataPortability: { enabled: true },
    });
    const provider = createSocialProvider({
      playerKey: 'p1',
      playerName: 'Nova',
      avatarSeed: 0,
      account: null,
      config,
      preference: 'real',
    });
    expect(provider).toBeInstanceOf(MockSocialProvider);
    const capabilities = provider.getCapabilities();
    expect(capabilities.like.available).toBe(false);
    expect(capabilities.like.reason).toMatch(/no TikTok account/i);
  });

  it('reports honest reasons while an import is still pending', () => {
    const pendingState: ActivityImportState = {
      ...importState(),
      status: 'pending',
      readyAt: null,
      counts: { like: 0, save: 0, repost: 0, post: 0 },
    };
    const provider = new TikTokDataPortabilityProvider({
      providerUserId: 'open-42',
      displayName: 'Nova',
      avatarUrl: null,
      importState: pendingState,
      actions: [],
      displayProvider: null,
    });
    const capabilities = provider.getCapabilities();
    expect(capabilities.like.available).toBe(false);
    expect(capabilities.like.reason).toMatch(/still preparing/i);
    expect(capabilities.repost.reason).toMatch(/reposts/i);
  });
});
