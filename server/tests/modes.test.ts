import { describe, expect, it } from 'vitest';
import { MODE_IDS } from '@cluecrew/shared';
import { computeRoomModeSupport } from '../src/game/modes.js';
import { MockSocialProvider } from '../src/providers/mock/MockSocialProvider.js';
import { TikTokProvider } from '../src/providers/tiktok/TikTokProvider.js';

function mockInfo(playerId: string) {
  const provider = new MockSocialProvider({
    playerKey: playerId,
    displayName: playerId,
    avatarSeed: 0,
    enabled: true,
  });
  return { playerId, source: 'mock' as const, capabilities: provider.getCapabilities() };
}

function tiktokInfo(playerId: string, scopes: string[]) {
  const provider = new TikTokProvider({
    providerUserId: `tt-${playerId}`,
    displayName: playerId,
    avatarUrl: null,
    scopes,
    accessToken: 'token',
    refreshToken: 'refresh',
    accessTokenExpiresAt: Date.now() + 3_600_000,
    refreshTokenExpiresAt: Date.now() + 86_400_000,
    config: {
      configured: true,
      clientKey: 'key',
      clientSecret: 'secret',
      redirectUri: 'http://localhost/callback',
      scopes,
    },
  });
  return { playerId, source: 'tiktok' as const, capabilities: provider.getCapabilities() };
}

describe('mode support computation', () => {
  it('marks every mode playable when demo players are present', () => {
    const support = computeRoomModeSupport([mockInfo('p1'), mockInfo('p2')]);
    for (const mode of MODE_IDS) {
      expect(support.suppliersByMode[mode]).toHaveLength(2);
    }
    expect(support.modesWithSuppliers).toEqual([...MODE_IDS]);
    for (const availability of support.availability) {
      expect(availability.playable).toBe(true);
      expect(availability.sources).toContain('mock');
      expect(availability.reason).toMatch(/demo data/i);
    }
  });

  it('only offers who_posted for a TikTok player with video.list', () => {
    const support = computeRoomModeSupport([
      tiktokInfo('p1', ['user.info.basic', 'video.list']),
      mockInfo('p2'),
    ]);
    expect(support.suppliersByMode.who_posted).toEqual(['p1', 'p2']);
    expect(support.suppliersByMode.who_liked).toEqual(['p2']);
    expect(support.suppliersByMode.who_reposted).toEqual(['p2']);
    expect(support.suppliersByMode.who_saved).toEqual(['p2']);
  });

  it('reports modes as unavailable when nobody can supply them', () => {
    const support = computeRoomModeSupport([tiktokInfo('p1', ['user.info.basic'])]);
    expect(support.suppliersByMode.who_liked).toHaveLength(0);
    expect(support.suppliersByMode.who_posted).toHaveLength(0);
    expect(support.modesWithSuppliers).toHaveLength(0);
    const liked = support.availability.find((entry) => entry.mode === 'who_liked')!;
    expect(liked.playable).toBe(false);
    expect(liked.sources).toContain('special_approval');
    expect(liked.reason).toMatch(/official API/i);
    const posted = support.availability.find((entry) => entry.mode === 'who_posted')!;
    expect(posted.playable).toBe(false);
    expect(posted.reason).toMatch(/video\.list/);
  });

  it('labels mixed rooms honestly', () => {
    const support = computeRoomModeSupport([
      tiktokInfo('real', ['user.info.basic', 'video.list']),
      mockInfo('demo'),
    ]);
    const posted = support.availability.find((entry) => entry.mode === 'who_posted')!;
    expect(posted.sources).toContain('official_api');
    expect(posted.sources).toContain('mock');
    expect(posted.reason).toMatch(/real TikTok data/i);
  });
});
