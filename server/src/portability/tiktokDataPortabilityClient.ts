import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../lib/errors.js';
import { mapTikTokApiError } from './apiErrors.js';
import type {
  AddDataRequestParams,
  AddDataRequestResult,
  CheckStatusParams,
  CheckStatusResult,
  DataPortabilityClient,
  DownloadArchiveParams,
  DownloadArchiveResult,
  TikTokExportStatus,
} from './types.js';

const API_BASE = 'https://open.tiktokapis.com';
const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

interface TikTokEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string; http_status_code?: number };
}

function toMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // TikTok documents Unix seconds for these fields.
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return toMillis(Number(value));
  }
  return null;
}

function normalizeStatus(value: unknown): TikTokExportStatus {
  switch (value) {
    case 'pending':
    case 'downloading':
    case 'expired':
    case 'cancelled':
      return value;
    default:
      return 'unknown';
  }
}

/**
 * Real HTTP client for TikTok's official Data Portability API.
 * Documentation: https://developers.tiktok.com/doc/data-portability-api-get-started/
 */
export class HttpTikTokDataPortabilityClient implements DataPortabilityClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly logger?: { warn: (message: string, meta?: Record<string, unknown>) => void },
  ) {}

  private async readEnvelope<T>(
    response: Response,
    fallback: { code: 'TIKTOK_DP_REQUEST_FAILED' | 'TIKTOK_DP_EXPORT_FAILED'; message: string },
  ): Promise<T> {
    let body: TikTokEnvelope<T> | null = null;
    try {
      body = (await response.json()) as TikTokEnvelope<T>;
    } catch {
      body = null;
    }
    if (!response.ok) {
      throw mapTikTokApiError({
        httpStatus: response.status,
        code: body?.error?.code,
        message: body?.error?.message,
        fallbackCode: fallback.code,
        fallbackMessage: `${fallback.message} (HTTP ${response.status})`,
      });
    }
    const code = body?.error?.code;
    if (code && code !== 'ok') {
      throw mapTikTokApiError({
        httpStatus: body?.error?.http_status_code ?? 0,
        code,
        message: body?.error?.message,
        fallbackCode: fallback.code,
        fallbackMessage: fallback.message,
      });
    }
    if (!body?.data) {
      throw new AppError(fallback.code, { message: fallback.message });
    }
    return body.data;
  }

  async addDataRequest(params: AddDataRequestParams): Promise<AddDataRequestResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${API_BASE}/v2/user/data/add/?fields=request_id`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data_format: params.dataFormat,
          category_selection_list: params.categories,
        }),
        signal: controller.signal,
      });
      const data = await this.readEnvelope<{ request_id: number | string }>(response, {
        code: 'TIKTOK_DP_REQUEST_FAILED',
        message: 'TikTok did not accept the activity data request.',
      });
      if (data.request_id === undefined || data.request_id === null) {
        throw new AppError('TIKTOK_DP_REQUEST_FAILED', {
          message: 'TikTok returned no request id for the activity data request.',
        });
      }
      return { requestId: String(data.request_id) };
    } catch (error) {
      throw this.wrapNetworkError(error, 'TIKTOK_DP_REQUEST_FAILED', controller);
    } finally {
      clearTimeout(timer);
    }
  }

  async checkStatus(params: CheckStatusParams): Promise<CheckStatusResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const fields = 'request_id,status,apply_time,collect_time,data_format,category_selection_list';
      const response = await this.fetchImpl(`${API_BASE}/v2/user/data/check/?fields=${fields}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ request_id: params.requestId }),
        signal: controller.signal,
      });
      const data = await this.readEnvelope<{
        request_id?: number | string;
        status?: string;
        apply_time?: number;
        collect_time?: number;
        data_format?: string;
        category_selection_list?: string[];
      }>(response, {
        code: 'TIKTOK_DP_EXPORT_FAILED',
        message: 'TikTok could not report the status of the activity data request.',
      });
      return {
        requestId: String(data.request_id ?? params.requestId),
        status: normalizeStatus(data.status),
        applyTimeMs: toMillis(data.apply_time),
        collectTimeMs: toMillis(data.collect_time),
        dataFormat: typeof data.data_format === 'string' ? data.data_format : 'json',
        categories: Array.isArray(data.category_selection_list) ? data.category_selection_list : [],
      };
    } catch (error) {
      throw this.wrapNetworkError(error, 'TIKTOK_DP_EXPORT_FAILED', controller);
    } finally {
      clearTimeout(timer);
    }
  }

  async downloadArchive(params: DownloadArchiveParams): Promise<DownloadArchiveResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${API_BASE}/v2/user/data/download/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ request_id: params.requestId }),
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') ?? '';
      // Errors come back as JSON even with HTTP 200 in some failure modes.
      if (!response.ok || contentType.includes('application/json')) {
        let body: TikTokEnvelope<unknown> | null = null;
        try {
          body = (await response.json()) as TikTokEnvelope<unknown>;
        } catch {
          body = null;
        }
        throw mapTikTokApiError({
          httpStatus: response.status,
          code: body?.error?.code,
          message: body?.error?.message,
          fallbackCode: 'TIKTOK_DP_EXPORT_FAILED',
          fallbackMessage: 'TikTok could not deliver the activity export.',
        });
      }
      if (!response.body) {
        throw new AppError('TIKTOK_DP_EXPORT_FAILED', {
          message: 'TikTok returned an empty export stream.',
        });
      }

      let bytes = 0;
      const file = fs.createWriteStream(params.destinationPath);
      const guard = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > params.maxBytes) {
            callback(
              new AppError('TIKTOK_DP_EXPORT_FAILED', {
                message: `The TikTok export exceeds the configured size limit (${Math.round(params.maxBytes / 1024 / 1024)} MB).`,
              }),
            );
            return;
          }
          callback(null, chunk);
        },
      });

      await pipeline(
        Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
        guard,
        file,
      );

      return { path: params.destinationPath, bytes };
    } catch (error) {
      throw this.wrapNetworkError(error, 'TIKTOK_DP_EXPORT_FAILED', controller);
    } finally {
      clearTimeout(timer);
    }
  }

  private wrapNetworkError(error: unknown, code: 'TIKTOK_DP_REQUEST_FAILED' | 'TIKTOK_DP_EXPORT_FAILED', controller: AbortController): AppError {
    if (error instanceof AppError) return error;
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return new AppError(code, { message: 'TikTok did not respond in time. Please try again.' });
    }
    return new AppError(code, {
      message: `Could not reach TikTok: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
