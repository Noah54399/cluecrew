export interface StoredPlayer {
  code: string;
  playerId: string;
  playerToken: string;
  name: string;
  avatarSeed: number;
}

export interface StoredIdentity {
  name: string;
  avatarSeed: number;
}

const PLAYER_PREFIX = 'cluecrew.player.';
const IDENTITY_KEY = 'cluecrew.identity';
const SOUND_KEY = 'cluecrew.sound';

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode) — the app still works per session.
  }
}

export function savePlayer(player: StoredPlayer): void {
  safeSet(`${PLAYER_PREFIX}${player.code}`, JSON.stringify(player));
}

export function getPlayer(code: string): StoredPlayer | null {
  const raw = safeGet(`${PLAYER_PREFIX}${code}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPlayer;
    if (!parsed.playerId || !parsed.playerToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function removePlayer(code: string): void {
  safeSet(`${PLAYER_PREFIX}${code}`, null);
}

export function saveIdentity(name: string, avatarSeed: number): void {
  safeSet(IDENTITY_KEY, JSON.stringify({ name, avatarSeed } satisfies StoredIdentity));
}

export function getIdentity(): StoredIdentity {
  const raw = safeGet(IDENTITY_KEY);
  if (!raw) return { name: '', avatarSeed: Math.floor(Math.random() * 12) };
  try {
    const parsed = JSON.parse(raw) as StoredIdentity;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      avatarSeed: Number.isFinite(parsed.avatarSeed) ? parsed.avatarSeed : 0,
    };
  } catch {
    return { name: '', avatarSeed: 0 };
  }
}

export function getSoundEnabled(): boolean {
  return safeGet(SOUND_KEY) !== 'off';
}

export function setSoundEnabled(enabled: boolean): void {
  safeSet(SOUND_KEY, enabled ? 'on' : 'off');
}

const THEME_KEY = 'cluecrew.theme';

export type ThemePreference = 'dark' | 'light' | 'system';

export function getThemePreference(): ThemePreference {
  const raw = safeGet(THEME_KEY);
  return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'dark';
}

export function setThemePreference(preference: ThemePreference): void {
  safeSet(THEME_KEY, preference);
}
