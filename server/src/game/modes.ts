import {
  MODES,
  MODE_IDS,
  OFFICIAL_TIKTOK_ACCESS,
  type ActionKind,
  type ModeAvailability,
  type ModeAvailabilitySource,
  type ModeId,
} from '@cluecrew/shared';
import type { ProviderCapability, ProviderCapabilities } from '../providers/types.js';

export interface PlayerProviderInfo {
  playerId: string;
  source: 'tiktok' | 'mock';
  capabilities: ProviderCapabilities;
}

export function capabilityForKind(
  capabilities: ProviderCapabilities,
  kind: ActionKind,
): ProviderCapability {
  switch (kind) {
    case 'like':
      return capabilities.like;
    case 'repost':
      return capabilities.repost;
    case 'save':
      return capabilities.save;
    case 'post':
      return capabilities.post;
  }
}

export interface RoomModeSupport {
  suppliersByMode: Record<ModeId, string[]>;
  availability: ModeAvailability[];
  modesWithSuppliers: ModeId[];
}

/**
 * Determines, per mode, which players can actually supply content and composes
 * the honest availability description shown in the lobby UI.
 */
export function computeRoomModeSupport(players: PlayerProviderInfo[]): RoomModeSupport {
  const suppliersByMode = {
    who_liked: [],
    who_reposted: [],
    who_saved: [],
    who_posted: [],
  } as Record<ModeId, string[]>;
  const availability: ModeAvailability[] = [];

  for (const modeId of MODE_IDS) {
    const kind = MODES[modeId].kind;
    const official: string[] = [];
    const mock: string[] = [];

    for (const player of players) {
      const capability = capabilityForKind(player.capabilities, kind);
      if (!capability.available) continue;
      if (player.source === 'tiktok') official.push(player.playerId);
      else mock.push(player.playerId);
    }

    const suppliers = [...official, ...mock];
    suppliersByMode[modeId] = suppliers;

    const sources: ModeAvailabilitySource[] = [];
    if (official.length > 0) sources.push('official_api');
    if (mock.length > 0) sources.push('mock');
    if (suppliers.length === 0) {
      sources.push(OFFICIAL_TIKTOK_ACCESS[modeId].approval === 'special' ? 'special_approval' : 'unavailable');
    }

    const access = OFFICIAL_TIKTOK_ACCESS[modeId];
    let reason: string;
    if (official.length > 0 && mock.length > 0) {
      reason = 'Real TikTok data for connected players, demo data for the rest.';
    } else if (official.length > 0) {
      reason = access.supported
        ? `Powered by the official TikTok Display API (${access.scope}).`
        : `Powered by approved access (${access.scope}).`;
    } else if (mock.length > 0) {
      reason = `${mock.length} player${mock.length === 1 ? '' : 's'} using clearly-labelled demo data. ${access.note}`;
    } else if (access.supported) {
      reason = `Needs at least one TikTok account granting ${access.scope}. ${access.note}`;
    } else {
      reason = `Not available through TikTok's official API for consumer apps.${access.scope ? ` Would require "${access.scope}".` : ''} ${access.note}`;
    }

    availability.push({ mode: modeId, playable: suppliers.length > 0, sources, reason });
  }

  return {
    suppliersByMode,
    availability,
    modesWithSuppliers: MODE_IDS.filter((modeId) => suppliersByMode[modeId].length > 0),
  };
}
