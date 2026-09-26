import type { ActivityImportStatus } from '@cluecrew/shared';

/** Status values documented for POST /v2/user/data/check/. */
export type TikTokExportStatus = 'pending' | 'downloading' | 'expired' | 'cancelled' | 'unknown';

export type NormalizedActionKind = 'like' | 'save' | 'repost';

export interface NormalizedActivity {
  kind: NormalizedActionKind;
  contentId: string;
  contentUrl: string;
  occurredAt: number | null;
}

export interface ExportParseResult {
  actions: NormalizedActivity[];
  /** Entries that could not be used (no/invalid/non-TikTok link). */
  skipped: number;
  /** Entries repeated within the same export. */
  duplicates: number;
  /** Files that were not valid JSON (counted, never guessed at). */
  malformedFiles: number;
  /** Section headings recognized in the archive (diagnostics). */
  sectionsFound: string[];
  filesScanned: number;
}

export interface AddDataRequestParams {
  accessToken: string;
  categories: string[];
  dataFormat: 'json' | 'text';
}

export interface AddDataRequestResult {
  requestId: string;
}

export interface CheckStatusParams {
  accessToken: string;
  requestId: string;
}

export interface CheckStatusResult {
  requestId: string;
  status: TikTokExportStatus;
  applyTimeMs: number | null;
  collectTimeMs: number | null;
  dataFormat: string;
  categories: string[];
}

export interface DownloadArchiveParams {
  accessToken: string;
  requestId: string;
  destinationPath: string;
  maxBytes: number;
}

export interface DownloadArchiveResult {
  path: string;
  bytes: number;
}

/**
 * Thin contract over TikTok's official Data Portability endpoints:
 *   POST /v2/user/data/add/      — start an export
 *   POST /v2/user/data/check/    — poll status
 *   POST /v2/user/data/download/ — stream the finished ZIP
 * Implemented for real in tiktokDataPortabilityClient.ts and replaced with a
 * stub in tests, so the whole import pipeline is testable without credentials.
 */
export interface DataPortabilityClient {
  addDataRequest(params: AddDataRequestParams): Promise<AddDataRequestResult>;
  checkStatus(params: CheckStatusParams): Promise<CheckStatusResult>;
  downloadArchive(params: DownloadArchiveParams): Promise<DownloadArchiveResult>;
}

export interface OEmbedMetadata {
  title: string | null;
  authorName: string | null;
  coverUrl: string | null;
}

export interface OEmbedClient {
  fetchMetadata(url: string): Promise<OEmbedMetadata | null>;
}

/** Maps the persisted import status to the public state machine. */
export function toPublicImportStatus(status: string): ActivityImportStatus {
  switch (status) {
    case 'requesting':
      return 'requesting';
    case 'pending':
      return 'pending';
    case 'importing':
      return 'importing';
    case 'ready':
      return 'ready';
    case 'expired':
      return 'expired';
    case 'failed':
    case 'cancelled':
      return 'failed';
    default:
      return 'none';
  }
}
