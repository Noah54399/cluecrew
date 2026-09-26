import type { ErrorCode } from '@cluecrew/shared';
import { AppError } from '../lib/errors.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderScopeMissingError,
} from '../providers/types.js';

export interface TikTokApiErrorInput {
  httpStatus?: number;
  code?: string | null;
  message?: string | null;
  fallbackCode: ErrorCode;
  fallbackMessage?: string;
}

/**
 * Maps a TikTok API error body/status onto the provider error classes so every
 * caller reacts consistently (reconnect vs. wait vs. give up).
 */
export function mapTikTokApiError(input: TikTokApiErrorInput): AppError {
  const { httpStatus = 0, code = '', message = '' } = input;
  const normalizedCode = (code ?? '').toLowerCase();
  const detail = message?.trim() ? message.trim() : null;

  if (httpStatus === 429 || normalizedCode.includes('rate') || normalizedCode.includes('limit')) {
    return new ProviderRateLimitError(
      detail ?? 'TikTok is rate limiting us right now. Please try again shortly.',
    );
  }
  if (
    httpStatus === 401 ||
    normalizedCode.includes('access_token') ||
    normalizedCode.includes('invalid_token') ||
    normalizedCode.includes('token_expired')
  ) {
    return new ProviderAuthError(
      detail ?? 'TikTok says the stored authorization is no longer valid. Please reconnect your account.',
    );
  }
  if (normalizedCode.includes('scope') || normalizedCode.includes('permission')) {
    return new ProviderScopeMissingError('portability.all.ongoing');
  }
  return new AppError(input.fallbackCode, {
    message: detail ?? input.fallbackMessage,
  });
}
