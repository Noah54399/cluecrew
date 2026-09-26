import { describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { api } from './helpers.js';

describe('REST API', () => {
  it('reports health and public config without secrets', async () => {
    const ctx = await createTestContext();
    try {
      const health = await api<{ ok: boolean; name: string }>(ctx.baseUrl, '/api/health');
      expect(health.status).toBe(200);
      expect(health.body.ok).toBe(true);

      const config = await api<Record<string, unknown>>(ctx.baseUrl, '/api/config');
      expect(config.status).toBe(200);
      const serialized = JSON.stringify(config.body);
      expect(serialized).not.toContain('clientSecret');
      expect(serialized).not.toContain('test-client-secret');
      const modeInfo = config.body.modeInfo as Record<string, { official: { supported: boolean } }>;
      expect(modeInfo.who_posted!.official.supported).toBe(true);
      expect(modeInfo.who_liked!.official.supported).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  it('creates, inspects and joins rooms', async () => {
    const ctx = await createTestContext();
    try {
      const created = await api<{ code: string; playerId: string; playerToken: string }>(
        ctx.baseUrl,
        '/api/rooms',
        { body: { name: 'Host', avatarSeed: 3 } },
      );
      expect(created.status).toBe(201);
      expect(created.body.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

      const info = await api<{ code: string; playerCount: number; status: string; joinable: boolean }>(
        ctx.baseUrl,
        `/api/rooms/${created.body.code}`,
      );
      expect(info.status).toBe(200);
      expect(info.body.playerCount).toBe(1);
      expect(info.body.status).toBe('lobby');
      expect(info.body.joinable).toBe(true);

      const joined = await api<{ playerId: string }>(
        ctx.baseUrl,
        `/api/rooms/${created.body.code}/join`,
        { body: { name: 'Bea', avatarSeed: 1 } },
      );
      expect(joined.status).toBe(201);

      const infoAfter = await api<{ playerCount: number }>(
        ctx.baseUrl,
        `/api/rooms/${created.body.code}`,
      );
      expect(infoAfter.body.playerCount).toBe(2);
    } finally {
      await ctx.close();
    }
  });

  it('rejects invalid room codes, duplicate names and unknown rooms', async () => {
    const ctx = await createTestContext();
    try {
      const invalid = await api<{ error: { code: string } }>(ctx.baseUrl, '/api/rooms/ZZZZZZ');
      expect(invalid.status).toBe(404);
      expect(invalid.body.error.code).toBe('ROOM_NOT_FOUND');

      const malformed = await api<{ error: { code: string } }>(ctx.baseUrl, '/api/rooms/not-a-code');
      expect(malformed.status).toBe(404);

      const created = await api<{ code: string }>(ctx.baseUrl, '/api/rooms', {
        body: { name: 'Host' },
      });
      const duplicate = await api<{ error: { code: string } }>(
        ctx.baseUrl,
        `/api/rooms/${created.body.code}/join`,
        { body: { name: 'host' } },
      );
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('NAME_TAKEN');
    } finally {
      await ctx.close();
    }
  });

  it('enforces room capacity', async () => {
    const ctx = await createTestContext({ maxPlayersPerRoom: 2 });
    try {
      const created = await api<{ code: string }>(ctx.baseUrl, '/api/rooms', {
        body: { name: 'Host' },
      });
      const second = await api(ctx.baseUrl, `/api/rooms/${created.body.code}/join`, {
        body: { name: 'Bea' },
      });
      expect(second.status).toBe(201);
      const third = await api<{ error: { code: string } }>(
        ctx.baseUrl,
        `/api/rooms/${created.body.code}/join`,
        { body: { name: 'Cyd' } },
      );
      expect(third.status).toBe(409);
      expect(third.body.error.code).toBe('ROOM_FULL');
    } finally {
      await ctx.close();
    }
  });

  it('rejects joining a room after the game started', async () => {
    const ctx = await createTestContext();
    try {
      const created = await api<{ code: string }>(ctx.baseUrl, '/api/rooms', {
        body: { name: 'Host' },
      });
      const room = ctx.roomManager.getRoomByCode(created.body.code)!;
      room.status = 'in_game';
      const join = await api<{ error: { code: string } }>(
        ctx.baseUrl,
        `/api/rooms/${created.body.code}/join`,
        { body: { name: 'Bea' } },
      );
      expect(join.status).toBe(409);
      expect(join.body.error.code).toBe('ROOM_IN_GAME');
    } finally {
      await ctx.close();
    }
  });

  it('requires a CSRF token for session-based state changes', async () => {
    const ctx = await createTestContext();
    try {
      const guest = await api<{ csrfToken: string; user: { id: string } }>(
        ctx.baseUrl,
        '/api/session/guest',
        { body: { name: 'Nova', avatarSeed: 0 } },
      );
      expect(guest.status).toBe(201);
      const cookie = guest.setCookie!.split(';')[0]!;

      const withoutToken = await api<{ error: { code: string } }>(ctx.baseUrl, '/api/rooms', {
        body: { name: 'Nova' },
        cookie,
      });
      expect(withoutToken.status).toBe(403);
      expect(withoutToken.body.error.code).toBe('CSRF_FAILED');

      const withToken = await api<{ code: string }>(ctx.baseUrl, '/api/rooms', {
        body: { name: 'Nova' },
        cookie,
        csrf: guest.body.csrfToken,
      });
      expect(withToken.status).toBe(201);

      const session = await api<{ user: { id: string } | null }>(ctx.baseUrl, '/api/session', {
        cookie,
      });
      expect(session.body.user?.id).toBe(guest.body.user.id);
    } finally {
      await ctx.close();
    }
  });

  it('deletes all user data on request', async () => {
    const ctx = await createTestContext();
    try {
      const guest = await api<{ csrfToken: string; user: { id: string } }>(
        ctx.baseUrl,
        '/api/session/guest',
        { body: { name: 'Nova' } },
      );
      const cookie = guest.setCookie!.split(';')[0]!;
      const room = await api<{ code: string; playerId: string }>(ctx.baseUrl, '/api/rooms', {
        body: { name: 'Nova' },
        cookie,
        csrf: guest.body.csrfToken,
      });
      expect(room.status).toBe(201);

      const deleted = await api(ctx.baseUrl, '/api/me', {
        method: 'DELETE',
        cookie,
        csrf: guest.body.csrfToken,
      });
      expect(deleted.status).toBe(200);
      expect(ctx.repos.users.get(guest.body.user.id)).toBeNull();
      expect(ctx.repos.players.get(room.body.playerId)).toBeNull();
    } finally {
      await ctx.close();
    }
  });

  it('reports TikTok as not configured when credentials are missing', async () => {
    const ctx = await createTestContext();
    try {
      const start = await api<{ error: { code: string } }>(ctx.baseUrl, '/api/auth/tiktok/start');
      expect(start.status).toBe(503);
      expect(start.body.error.code).toBe('TIKTOK_NOT_CONFIGURED');
    } finally {
      await ctx.close();
    }
  });
});
