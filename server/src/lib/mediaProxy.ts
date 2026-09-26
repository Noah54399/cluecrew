import type { ServerConfig } from '../config.js';
import { deriveKey, hmacBase64Url } from './crypto.js';

const ALLOWED_MEDIA_HOSTS = [
  '.tiktokcdn.com',
  '.tiktokcdn-us.com',
  '.tiktokcdn-eu.com',
  '.tiktokcdn-va.com',
  '.ibyteimg.com',
  '.byteoversea.com',
  '.tiktok.com',
];

export function isAllowedMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    return ALLOWED_MEDIA_HOSTS.some(
      (suffix) => url.hostname === suffix.replace(/^\./, '') || url.hostname.endsWith(suffix),
    );
  } catch {
    return false;
  }
}

function mediaSignatureKey(config: ServerConfig): Buffer {
  return deriveKey(config.tokenEncryptionKey, 'media-proxy-v1');
}

export function signMediaUrl(url: string, config: ServerConfig): string {
  return hmacBase64Url(url, mediaSignatureKey(config));
}

/** Signed, allow-listed image proxy URL so we never hotlink TikTok CDNs directly. */
export function buildProxiedMediaUrl(url: string | null, config: ServerConfig): string | null {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  if (!isAllowedMediaUrl(url)) return null;
  const signature = signMediaUrl(url, config);
  return `/api/media/proxy?u=${encodeURIComponent(url)}&s=${encodeURIComponent(signature)}`;
}

export function verifyMediaSignature(url: string, signature: string, config: ServerConfig): boolean {
  const expected = signMediaUrl(url, config);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}
