import crypto from 'node:crypto';

const ENCRYPTION_VERSION = 'v1';

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function parseEncryptionKey(hex: string | null | undefined): Buffer | null {
  if (!hex) return null;
  try {
    const buffer = Buffer.from(hex.trim(), 'hex');
    return buffer.length === 32 ? buffer : null;
  } catch {
    return null;
  }
}

/** AES-256-GCM encryption for OAuth tokens at rest. */
export function encryptString(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptString(payload: string, key: Buffer): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) {
    throw new Error('Unsupported ciphertext format');
  }
  const iv = Buffer.from(parts[1]!, 'base64url');
  const tag = Buffer.from(parts[2]!, 'base64url');
  const data = Buffer.from(parts[3]!, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function encryptJson(value: unknown, key: Buffer): string {
  return encryptString(JSON.stringify(value), key);
}

export function decryptJson<T>(payload: string, key: Buffer): T {
  return JSON.parse(decryptString(payload, key)) as T;
}

export function hmacBase64Url(data: string, key: Buffer): string {
  return crypto.createHmac('sha256', key).update(data).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/** Deterministic key derivation for scoped secrets (media proxy signatures, etc.). */
export function deriveKey(base: Buffer, label: string): Buffer {
  return crypto.createHmac('sha256', base).update(label).digest();
}
