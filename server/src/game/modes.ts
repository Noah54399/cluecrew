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
  source: 'tiktok' | 'none';
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
 * Determines, per mode, which players can supply real content and composes the
 * honest availability description shown in the lobby. There is no demo data:
 * a mode with no supplier is simply unavailable, with the reason and the
 * TikTok permission it would require.
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
    const suppliers: string[] = [];
    const reasons: string[] = [];

    for (const player of players) {
      const capability = capabilityForKind(player.capabilities, kind);
      if (!capability.available) continue;
      suppliers.push(player.playerId);
      if (capability.reason) reasons.push(capability.reason);
    }

    suppliersByMode[modeId] = suppliers;

    const sources: ModeAvailabilitySource[] = [];
    if (suppliers.length > 0) {
      sources.push('official_api');
    } else {
      sources.push(
        OFFICIAL_TIKTOK_ACCESS[modeId].approval === 'special' ? 'special_approval' : 'unavailable',
      );
    }

    const access = OFFICIAL_TIKTOK_ACCESS[modeId];
    let reason: string;
    if (suppliers.length > 0) {
      reason = reasons[0] ?? 'Powered by real TikTok data from connected accounts.';
    } else {
      reason = `No connected player can supply this mode. ${access.note}${
        access.supported
          ? ` Requires the ${access.scope} permission.`
          : access.scope
            ? ` Would require ${access.scope}.`
            : ''
      }`;
    }

    availability.push({ mode: modeId, playable: suppliers.length > 0, sources, reason });
  }

  return {
    suppliersByMode,
    availability,
    modesWithSuppliers: MODE_IDS.filter((modeId) => suppliersByMode[modeId].length > 0),
  };
}
