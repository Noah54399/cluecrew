import { describe, expect, it } from 'vitest';
import { MODE_IDS } from '@cluecrew/shared';
import { computeRoomModeSupport } from '../src/game/modes.js';
import { DisconnectedSocialProvider } from '../src/providers/DisconnectedSocialProvider.js';
import { TikTokProvider } from '../src/providers/tiktok/TikTokProvider.js';
import { TestSocialProvider } from './testProvider.js';

function connectedInfo(playerId: string) {
  const provider = new TestSocialProvider({
    playerKey: playerId,
    playerName: playerId,
    avatarSeed: 0,
  });
  return { playerId, source: 'tiktok' as const, capabilities: provider.getCapabilities() };
}

function disconnectedInfo(playerId: string) {
  const provider = new DisconnectedSocialProvider();
  return { playerId, source: 'none' as const, capabilities: provider.getCapabilities() };
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

describe('mode support computation (real data only)', () => {
  it('marks modes playable when connected players can supply them', () => {
    const support = computeRoomModeSupport([connectedInfo('p1'), connectedInfo('p2')]);
    for (const mode of MODE_IDS) {
      expect(support.suppliersByMode[mode]).toHaveLength(2);
    }
    expect(support.modesWithSuppliers).toEqual([...MODE_IDS]);
    for (const availability of support.availability) {
      expect(availability.playable).toBe(true);
      expect(availability.sources).toContain('official_api');
    }
  });

  it('only offers who_posted for a TikTok player with video.list', () => {
    const support = computeRoomModeSupport([
      tiktokInfo('p1', ['user.info.basic', 'video.list']),
      disconnectedInfo('p2'),
    ]);
    expect(support.suppliersByMode.who_posted).toEqual(['p1']);
    expect(support.suppliersByMode.who_liked).toEqual([]);
    expect(support.suppliersByMode.who_reposted).toEqual([]);
    expect(support.suppliersByMode.who_saved).toEqual([]);
  });

  it('reports modes as unavailable when nobody is connected', () => {
    const support = computeRoomModeSupport([disconnectedInfo('p1'), disconnectedInfo('p2')]);
    expect(support.modesWithSuppliers).toHaveLength(0);
    for (const availability of support.availability) {
      expect(availability.playable).toBe(false);
      expect(availability.reason).toMatch(/no connected player/i);
    }
    const liked = support.availability.find((entry) => entry.mode === 'who_liked')!;
    expect(liked.sources).toContain('special_approval');
    expect(liked.reason).toMatch(/portability/i);
    const posted = support.availability.find((entry) => entry.mode === 'who_posted')!;
    expect(posted.reason).toMatch(/video\.list/);
  });

  it('says exactly which permission a connected account is missing', () => {
    const support = computeRoomModeSupport([tiktokInfo('p1', ['user.info.basic'])]);
    const posted = support.availability.find((entry) => entry.mode === 'who_posted')!;
    expect(posted.playable).toBe(false);
    expect(posted.reason).toMatch(/video\.list/);
    expect(support.modesWithSuppliers).toHaveLength(0);
  });
});
