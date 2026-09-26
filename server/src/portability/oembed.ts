import { isAllowedMediaUrl } from '../lib/mediaProxy.js';
import type { OEmbedClient, OEmbedMetadata } from './types.js';

const OEMBED_ENDPOINT = 'https://www.tiktok.com/oembed';
const TIMEOUT_MS = 4_000;

interface OEmbedPayload {
  title?: unknown;
  author_name?: unknown;
  thumbnail_url?: unknown;
}

/**
 * Best-effort display metadata for public TikTok videos using TikTok's public
 * oEmbed endpoint (the same service used by embeds — no authentication).
 *
 * Used ONLY to make exported links look nice in a round (title / creator /
 * cover). Failure is always non-fatal: the game still works with the raw link.
 */
export class TikTokOEmbedClient implements OEmbedClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchMetadata(url: string): Promise<OEmbedMetadata | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${OEMBED_ENDPOINT}?url=${encodeURIComponent(url)}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as OEmbedPayload;
      const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : null;
      const authorName =
        typeof payload.author_name === 'string' && payload.author_name.trim()
          ? payload.author_name.trim()
          : null;
      // Only keep thumbnails we are allowed to proxy.
      const coverUrl =
        typeof payload.thumbnail_url === 'string' && isAllowedMediaUrl(payload.thumbnail_url)
          ? payload.thumbnail_url
          : null;
      return { title, authorName, coverUrl };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
