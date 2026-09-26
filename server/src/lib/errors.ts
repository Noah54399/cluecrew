import { ERROR_MESSAGES, type ErrorCode } from '@cluecrew/shared';

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case 'RATE_LIMITED':
    case 'TIKTOK_RATE_LIMITED':
      return 429;
    case 'UNAUTHORIZED':
    case 'CSRF_FAILED':
    case 'SOCKET_AUTH_FAILED':
      return 401;
    case 'NOT_HOST':
    case 'NOT_IN_ROOM':
      return 403;
    case 'ROOM_NOT_FOUND':
    case 'ROOM_EXPIRED':
    case 'PLAYER_NOT_FOUND':
      return 404;
    case 'ROOM_FULL':
    case 'ROOM_IN_GAME':
    case 'ROOM_CLOSED':
    case 'NAME_TAKEN':
      return 409;
    case 'TIKTOK_API_ERROR':
    case 'TIKTOK_AUTH_FAILED':
    case 'CONTENT_UNAVAILABLE':
      return 502;
    case 'TIKTOK_NOT_CONFIGURED':
      return 503;
    case 'INTERNAL':
      return 500;
    default:
      return 400;
  }
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, options: { message?: string; status?: number; details?: unknown } = {}) {
    super(options.message ?? ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? defaultStatus(code);
    this.details = options.details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toAppError(error: unknown, fallback: ErrorCode = 'INTERNAL'): AppError {
  if (isAppError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AppError(fallback, { message, details: error });
}
