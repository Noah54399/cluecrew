import crypto from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@cluecrew/shared';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomBytesHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function randomId(prefix?: string, bytes = 9): string {
  const raw = crypto.randomBytes(bytes);
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    out += ID_ALPHABET[raw[i]! % ID_ALPHABET.length];
  }
  return prefix ? `${prefix}_${out}` : out;
}

export function randomRoomCode(length = ROOM_CODE_LENGTH): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ROOM_CODE_ALPHABET[bytes[i]! % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

/** Player reconnect tokens are high-entropy secrets compared by hash. */
export function randomSecretToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

export function msFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}
