import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import type { ServerConfig } from '../config.js';
import { AppError, toAppError } from './errors.js';
import type { Logger } from './logger.js';
import { SlidingWindowLimiter } from './rateLimit.js';
import type { SessionService } from '../auth/sessions.js';

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function ipOf(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * CORS for split deployments (e.g. Netlify frontend + Render backend).
 * Credentialed requests are only allowed from the configured origins.
 */
export function corsMiddleware(config: ServerConfig): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-csrf-token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

/** Blocks cross-site state-changing requests from unexpected origins. */
export function originGuard(config: ServerConfig): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      res.status(403).json({
        error: { code: 'CSRF_FAILED', message: 'Request origin is not allowed.' },
      });
      return;
    }
    next();
  };
}

/** Double-submit style CSRF protection for cookie-based sessions. */
export function requireCsrf(sessions: SessionService): RequestHandler {
  return (req, res, next) => {
    const auth = sessions.getAuth(req);
    if (!auth) return next();
    const token = req.headers['x-csrf-token'];
    if (typeof token !== 'string' || token !== auth.session.csrfToken) {
      res.status(403).json({
        error: {
          code: 'CSRF_FAILED',
          message: 'Your session security check failed. Please reload the page.',
        },
      });
      return;
    }
    next();
  };
}

export function rateLimit(limiter: SlidingWindowLimiter, bucket: string): RequestHandler {
  return (req, res, next) => {
    const decision = limiter.check(`${bucket}:${ipOf(req)}`);
    if (!decision.allowed) {
      res.setHeader('Retry-After', Math.ceil(decision.retryAfterMs / 1000));
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests \u2014 please slow down a moment.',
        },
      });
      return;
    }
    next();
  };
}

export function securityHeaders(config: ServerConfig): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (config.isProduction) {
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: blob:",
          "connect-src 'self' ws: wss:",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      );
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/health') return;
      logger.debug(`${req.method} ${req.path} ${res.statusCode}`, {
        ms: Date.now() - startedAt,
      });
    });
    next();
  };
}

export function notFoundHandler(logger: Logger): RequestHandler {
  return (req, res) => {
    logger.debug('Unmatched route', { method: req.method, path: req.path });
    res.status(404).json({
      error: { code: 'ROOM_NOT_FOUND', message: 'That API route does not exist.' },
    });
  };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (error, _req, res, _next) => {
    if (res.headersSent) return;
    const appError = toAppError(error);
    if (appError.status >= 500) {
      logger.error('Unhandled request error', {
        code: appError.code,
        message: appError.message,
      });
    }
    const body = {
      error: { code: appError.code, message: appError.message },
    };
    res.status(appError.status).json(body);
  };
}

export function assert(
  condition: unknown,
  code: AppError['code'],
  message?: string,
): asserts condition {
  if (!condition) throw new AppError(code, message ? { message } : undefined);
}
