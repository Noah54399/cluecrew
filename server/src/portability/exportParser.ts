import { strFromU8, unzipSync, type Unzipped } from 'fflate';
import { AppError } from '../lib/errors.js';
import type { ExportParseResult, NormalizedActionKind, NormalizedActivity } from './types.js';

/**
 * Parses a TikTok Data Portability export ZIP.
 *
 * Privacy contract: this parser walks the archive looking ONLY for the
 * documented "Like List" and "Favourite Videos" sections (plus a
 * forward-compatible "Reposts" match). Everything else in the archive —
 * direct messages, purchases, searches, watch history, profile, followers —
 * is never read into memory as data and never returned.
 *
 * The exact internal layout of the ZIP is not documented by TikTok, so the
 * parser is intentionally tolerant: it scans every JSON/text entry recursively
 * and recognizes sections by normalized key names.
 */

const SECTION_KINDS: Record<string, NormalizedActionKind> = {
  // Documented Data Portability sections (Full Archive)
  likelist: 'like',
  favouritevideos: 'save',
  favoritevideos: 'save', // US spelling, defensive
  // Defensive aliases
  likedvideos: 'like',
  savedvideos: 'save',
  // Forward compatible: reposts are not documented today; if TikTok adds a
  // section, importing it is a deliberate, reviewable choice.
  reposts: 'repost',
  repostedvideos: 'repost',
};

const URL_KEYS = ['videolandingpagelink', 'videolink', 'videourl', 'sharedurl', 'link', 'url'];
const DATE_KEYS = ['date', 'createdate', 'timestamp', 'time', 'actiondate'];

const TIKTOK_URL_PATTERN = /https?:\/\/[^\s"',<>)\]]+/gi;
const TIKTOK_VIDEO_ID_PATTERN = /\/(?:video|photo|v)\/(\d{5,25})/;

export interface ParseArchiveOptions {
  maxEntries?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxActions?: number;
}

interface ParseContext {
  actions: NormalizedActivity[];
  skipped: number;
  duplicates: number;
  malformedFiles: number;
  sections: Set<string>;
  filesScanned: number;
  seen: Set<string>;
  maxActions: number;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extracts a canonical TikTok video reference from a landing page link. */
export function extractVideoRef(
  url: string,
): { contentId: string; contentUrl: string } | null {
  const hostMatch = /^https?:\/\/([a-z0-9.-]+)\//i.exec(url);
  if (!hostMatch) return null;
  const host = hostMatch[1]!.toLowerCase();
  if (!(host === 'tiktok.com' || host.endsWith('.tiktok.com'))) return null;
  const idMatch = TIKTOK_VIDEO_ID_PATTERN.exec(url);
  if (!idMatch) return null;
  return { contentId: idMatch[1]!, contentUrl: url };
}

/** Parses TikTok export dates ("2024-06-01 12:31:34", ISO, unix seconds/millis). */
export function parseActivityDate(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input) && input > 0) {
    if (input > 1e12) return input;
    if (input > 1e9) return input * 1000;
    return null;
  }
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return parseActivityDate(Number(trimmed));

  const candidate = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const hasZone = /(z|[+-]\d{2}:?\d{2})$/i.test(candidate);
  const parsed = Date.parse(hasZone ? candidate : `${candidate}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordUrl(entry: unknown, kind: NormalizedActionKind, ctx: ParseContext): void {
  let url: string | null = null;
  let occurredAt: number | null = null;

  if (typeof entry === 'string') {
    url = entry.match(TIKTOK_URL_PATTERN)?.[0] ?? null;
  } else if (Array.isArray(entry)) {
    for (const item of entry) recordUrl(item, kind, ctx);
    return;
  } else if (isRecord(entry)) {
    for (const [key, value] of Object.entries(entry)) {
      const normalized = normalizeKey(key);
      if (typeof value === 'string') {
        if (!url && URL_KEYS.includes(normalized) && /^https?:/i.test(value)) url = value;
        else if (occurredAt === null && DATE_KEYS.includes(normalized)) {
          occurredAt = parseActivityDate(value);
        }
      } else if (occurredAt === null && DATE_KEYS.includes(normalized)) {
        occurredAt = parseActivityDate(value);
      }
    }
    if (!url) {
      // Last resort inside a known section: any string that looks like a TikTok link.
      for (const value of Object.values(entry)) {
        if (typeof value === 'string' && /(^|\.)tiktok\.com\//i.test(value)) {
          url = value.match(TIKTOK_URL_PATTERN)?.[0] ?? null;
          if (url) break;
        }
      }
    }
  }

  if (!url) {
    ctx.skipped += 1;
    return;
  }
  const ref = extractVideoRef(url);
  if (!ref) {
    ctx.skipped += 1;
    return;
  }
  const dedupeKey = `${kind}:${ref.contentId}`;
  if (ctx.seen.has(dedupeKey)) {
    ctx.duplicates += 1;
    return;
  }
  ctx.seen.add(dedupeKey);
  if (ctx.actions.length < ctx.maxActions) {
    ctx.actions.push({
      kind,
      contentId: ref.contentId,
      contentUrl: ref.contentUrl,
      occurredAt,
    });
  } else {
    ctx.skipped += 1;
  }
}

function looksLikeEntry(record: Record<string, unknown>): boolean {
  return Object.keys(record).some((key) => URL_KEYS.includes(normalizeKey(key)));
}

function collectSection(value: unknown, kind: NormalizedActionKind, ctx: ParseContext): void {
  if (Array.isArray(value)) {
    for (const entry of value) recordUrl(entry, kind, ctx);
    return;
  }
  if (!isRecord(value)) {
    recordUrl(value, kind, ctx);
    return;
  }
  if (looksLikeEntry(value)) {
    recordUrl(value, kind, ctx);
    return;
  }
  // Containers: { items: [...] }, { "2024-01-01": "https://…" }, etc.
  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const entry of nested) recordUrl(entry, kind, ctx);
    } else if (isRecord(nested)) {
      recordUrl(nested, kind, ctx);
    } else if (typeof nested === 'string') {
      recordUrl(nested, kind, ctx);
    }
  }
}

function walkJson(node: unknown, ctx: ParseContext, depth = 0): void {
  if (depth > 12 || ctx.actions.length >= ctx.maxActions) return;
  if (Array.isArray(node)) {
    for (const item of node) walkJson(item, ctx, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const kind = SECTION_KINDS[normalizeKey(key)];
    if (kind) {
      const label = key.trim();
      if (label.length > 0 && label.length < 80) ctx.sections.add(label);
      collectSection(value, kind, ctx);
      continue;
    }
    if (isRecord(value) || Array.isArray(value)) walkJson(value, ctx, depth + 1);
  }
}

/** Best-effort support for `data_format: "text"` archives. */
function parseTextExport(text: string, ctx: ParseContext): void {
  let currentKind: NormalizedActionKind | null = null;
  let lastDate: number | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const normalized = normalizeKey(line);

    // Headings have no colons ("Like List", "Searches"); entry lines always do
    // ("Date: …", "Video landing page link: …"). Any heading we do not know
    // ends the current section, so URLs from other sections are never read.
    const looksLikeHeading = !line.includes(':') && line.length < 80 && /[a-z]/i.test(line);
    if (looksLikeHeading) {
      const section = Object.entries(SECTION_KINDS).find(([key]) => normalized.startsWith(key));
      currentKind = section ? section[1] : null;
      if (section) ctx.sections.add(line);
      continue;
    }

    const dateValue = line.includes(':') ? line.slice(line.indexOf(':') + 1).trim() : line;
    if (normalized.startsWith('date') || normalized.startsWith('timestamp')) {
      const parsed = parseActivityDate(dateValue);
      if (parsed !== null) lastDate = parsed;
      continue;
    }

    // Privacy: URLs are only ever collected inside a recognized section.
    if (!currentKind) continue;
    const matches = line.match(TIKTOK_URL_PATTERN);
    if (!matches) continue;
    for (const url of matches) {
      recordUrl({ 'Video landing page link': url, Date: lastDate ?? undefined }, currentKind, ctx);
    }
  }
}

export function parseExportArchive(
  buffer: Uint8Array,
  options: ParseArchiveOptions = {},
): ExportParseResult {
  const maxEntries = options.maxEntries ?? 500;
  const maxFileBytes = options.maxFileBytes ?? 32 * 1024 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 64 * 1024 * 1024;
  const maxActions = options.maxActions ?? 5000;

  const ctx: ParseContext = {
    actions: [],
    skipped: 0,
    duplicates: 0,
    malformedFiles: 0,
    sections: new Set(),
    filesScanned: 0,
    seen: new Set(),
    maxActions,
  };

  let entries: Unzipped;
  try {
    entries = unzipSync(buffer, { filter: (file) => file.originalSize <= maxFileBytes });
  } catch {
    throw new AppError('TIKTOK_DP_PARSE_FAILED', {
      message: 'The downloaded TikTok export is not a readable ZIP archive. Nothing was imported.',
    });
  }

  let processed = 0;
  let totalBytes = 0;
  let dataEntries = 0;

  for (const [name, bytes] of Object.entries(entries)) {
    if (processed >= maxEntries || totalBytes >= maxTotalBytes) break;
    processed += 1;
    const lower = name.toLowerCase();
    const isJson = lower.endsWith('.json');
    const isText = lower.endsWith('.txt');
    if (!isJson && !isText) continue;
    if (bytes.byteLength > maxFileBytes) continue;
    totalBytes += bytes.byteLength;
    dataEntries += 1;
    ctx.filesScanned += 1;

    const text = strFromU8(bytes);
    if (isJson) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        ctx.malformedFiles += 1;
        continue;
      }
      walkJson(parsed, ctx);
    } else {
      parseTextExport(text, ctx);
    }
  }

  if (
    ctx.actions.length === 0 &&
    ctx.sections.size === 0 &&
    dataEntries > 0 &&
    ctx.malformedFiles === dataEntries
  ) {
    throw new AppError('TIKTOK_DP_PARSE_FAILED', {
      message: 'Every data file in the TikTok export was unreadable. Nothing was imported.',
    });
  }

  return {
    actions: ctx.actions,
    skipped: ctx.skipped,
    duplicates: ctx.duplicates,
    malformedFiles: ctx.malformedFiles,
    sectionsFound: [...ctx.sections],
    filesScanned: ctx.filesScanned,
  };
}
