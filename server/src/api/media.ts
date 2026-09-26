import { Router } from 'express';
import type { ServerConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { asyncHandler, rateLimit } from '../lib/http.js';
import { isAllowedMediaUrl, verifyMediaSignature } from '../lib/mediaProxy.js';
import { SlidingWindowLimiter } from '../lib/rateLimit.js';

const MAX_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

interface CacheEntry {
  contentType: string;
  body: Buffer;
  expiresAt: number;
}

/**
 * Signed, allow-listed image proxy for TikTok CDN covers:
 * - only URLs we signed ourselves are accepted (HMAC)
 * - only allow-listed TikTok CDN hosts are fetched
 * - responses are cached in memory and capped in size
 */
export function createMediaRouter(config: ServerConfig): Router {
  const router = Router();
  const cache = new Map<string, CacheEntry>();
  const limiter = new SlidingWindowLimiter(300, 60_000);

  router.get(
    '/media/proxy',
    rateLimit(limiter, 'media'),
    asyncHandler(async (req, res) => {
      const url = typeof req.query.u === 'string' ? req.query.u : '';
      const signature = typeof req.query.s === 'string' ? req.query.s : '';
      if (!url || !signature) throw new AppError('VALIDATION_FAILED');
      if (!isAllowedMediaUrl(url)) {
        throw new AppError('VALIDATION_FAILED', { message: 'Media host is not allowed.' });
      }
      if (!verifyMediaSignature(url, signature, config)) {
        throw new AppError('VALIDATION_FAILED', { message: 'Media signature is invalid.' });
      }

      const cached = cache.get(url);
      if (cached && cached.expiresAt > Date.now()) {
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(cached.body);
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const upstream = await fetch(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            Accept: 'image/*',
            'User-Agent': 'ClueCrew/1.0 (media proxy)',
          },
        });
        if (!isAllowedMediaUrl(upstream.url)) {
          throw new AppError('VALIDATION_FAILED', { message: 'Media redirect target is not allowed.' });
        }
        if (!upstream.ok) {
          throw new AppError('CONTENT_UNAVAILABLE', {
            message: `Media fetch failed with HTTP ${upstream.status}.`,
          });
        }
        const contentType = upstream.headers.get('content-type') ?? '';
        if (!contentType.startsWith('image/')) {
          throw new AppError('VALIDATION_FAILED', { message: 'Only image media can be proxied.' });
        }
        const declaredLength = Number(upstream.headers.get('content-length') ?? '0');
        if (declaredLength > MAX_BYTES) {
          throw new AppError('VALIDATION_FAILED', { message: 'Media file is too large.' });
        }
        const body = Buffer.from(await upstream.arrayBuffer());
        if (body.byteLength > MAX_BYTES) {
          throw new AppError('VALIDATION_FAILED', { message: 'Media file is too large.' });
        }

        if (cache.size >= CACHE_MAX_ENTRIES) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey) cache.delete(oldestKey);
        }
        cache.set(url, { contentType, body, expiresAt: Date.now() + CACHE_TTL_MS });

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(body);
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return router;
}
