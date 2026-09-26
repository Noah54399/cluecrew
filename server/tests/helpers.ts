import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { DEFAULT_SETTINGS, type ActionKind, type GameSettings, type RoomState } from '@cluecrew/shared';
import { loadConfig, type ConfigOverrides, type ServerConfig } from '../src/config.js';
import { openAppDatabase, type Db } from '../src/database/db.js';
import { createRepositories, type Repositories } from '../src/database/repositories.js';
import { SessionService } from '../src/auth/sessions.js';
import { TikTokOAuthService } from '../src/auth/tiktokOAuth.js';
import { RoomManager } from '../src/game/roomManager.js';
import { createApp } from '../src/app.js';
import { createSocketServer } from '../src/realtime/socket.js';
import { mulberry32 } from '../src/lib/rng.js';
import { DataPortabilityService } from '../src/portability/DataPortabilityService.js';
import type {
  AddDataRequestParams,
  AddDataRequestResult,
  CheckStatusParams,
  CheckStatusResult,
  DataPortabilityClient,
  DownloadArchiveParams,
  DownloadArchiveResult,
  TikTokExportStatus,
} from '../src/portability/types.js';
import type { ContentItem } from '../src/providers/types.js';
import type { EngineDeps } from '../src/game/engine.js';

/** Test double for TikTok's Data Portability endpoints. */
export class StubDataPortabilityClient implements DataPortabilityClient {
  /** Queue of statuses returned by checkStatus() (last value repeats). */
  statuses: TikTokExportStatus[] = ['pending'];
  archiveProvider: (() => Uint8Array) | null = null;
  addError: Error | null = null;
  checkError: Error | null = null;
  downloadError: Error | null = null;
  addCalls = 0;
  checkCalls = 0;
  downloadCalls = 0;
  lastCategories: string[] = [];
  nextRequestId = '111222333';

  async addDataRequest(params: AddDataRequestParams): Promise<AddDataRequestResult> {
    this.addCalls += 1;
    this.lastCategories = params.categories;
    if (this.addError) throw this.addError;
    return { requestId: this.nextRequestId };
  }

  async checkStatus(_params: CheckStatusParams): Promise<CheckStatusResult> {
    this.checkCalls += 1;
    if (this.checkError) throw this.checkError;
    const status = this.statuses.length > 1 ? this.statuses.shift()! : (this.statuses[0] ?? 'pending');
    return {
      requestId: '111222333',
      status,
      applyTimeMs: Date.now(),
      collectTimeMs: null,
      dataFormat: 'json',
      categories: this.lastCategories,
    };
  }

  async downloadArchive(params: DownloadArchiveParams): Promise<DownloadArchiveResult> {
    this.downloadCalls += 1;
    if (this.downloadError) throw this.downloadError;
    const bytes = this.archiveProvider ? this.archiveProvider() : new Uint8Array();
    fs.writeFileSync(params.destinationPath, bytes);
    return { path: params.destinationPath, bytes: bytes.byteLength };
  }
}

export interface TestContext {
  baseUrl: string;
  config: ServerConfig;
  db: Db;
  repos: Repositories;
  sessions: SessionService;
  oauth: TikTokOAuthService;
  roomManager: RoomManager;
  dataPortability: DataPortabilityService;
  dpClient: StubDataPortabilityClient;
  importDir: string;
  httpServer: HttpServer;
  close(): Promise<void>;
}

export async function createTestContext(overrides: ConfigOverrides = {}): Promise<TestContext> {
  const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cluecrew-imports-'));
  const config = loadConfig({
    nodeEnv: 'test',
    databasePath: ':memory:',
    allowMockProvider: true,
    publicUrl: 'http://127.0.0.1',
    clientUrl: 'http://127.0.0.1',
    allowedOrigins: ['http://localhost', 'http://127.0.0.1'],
    timings: { introMs: 40, contentMs: 40, lockMs: 40, revealMs: 40, pointsMs: 50 },
    ...overrides,
    dataPortability: {
      importDir,
      pollIntervalMs: 0,
      ...overrides.dataPortability,
    },
  });

  const db = openAppDatabase(config);
  const repos = createRepositories(db);
  const sessions = new SessionService(repos, config);

  const dpClient = new StubDataPortabilityClient();
  const dataPortability = new DataPortabilityService({
    config,
    repos,
    client: dpClient,
    oEmbed: null,
    now: () => Date.now(),
  });

  const oauth = new TikTokOAuthService(config, repos, {
    onLinked: (userId) => {
      void dataPortability.ensureStarted(userId);
    },
    onDisconnect: (userId) => dataPortability.deleteImport(userId),
  });

  const roomManager = new RoomManager({
    config,
    repos,
    deps: { now: () => Date.now(), rng: mulberry32(1234), timings: config.timings },
    dataPortability,
  });
  const app = createApp({ config, repos, sessions, oauth, roomManager, dataPortability });
  const httpServer = createServer(app);
  const io = createSocketServer({ httpServer, config, roomManager });
  roomManager.attachIo(io);

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = (httpServer.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    config,
    db,
    repos,
    sessions,
    oauth,
    roomManager,
    dataPortability,
    dpClient,
    importDir,
    httpServer,
    async close() {
      roomManager.dispose();
      io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      db.close();
      try {
        fs.rmSync(importDir, { recursive: true, force: true });
      } catch {
        // Non-fatal.
      }
    },
  };
}

export interface ApiResponse<T> {
  status: number;
  body: T;
  setCookie: string | null;
}

export async function api<T = unknown>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    csrf?: string;
  } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.cookie) headers['Cookie'] = options.cookie;
  if (options.csrf) headers['x-csrf-token'] = options.csrf;
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    status: response.status,
    body: body as T,
    setCookie: response.headers.get('set-cookie'),
  };
}

export interface TestPlayer {
  playerId: string;
  playerToken: string;
  code: string;
  socket?: ClientSocket;
}

export async function createRoomViaApi(
  context: TestContext,
  name: string,
  avatarSeed = 0,
): Promise<TestPlayer> {
  const response = await api<{ code: string; playerId: string; playerToken: string }>(
    context.baseUrl,
    '/api/rooms',
    { body: { name, avatarSeed } },
  );
  if (response.status !== 201) {
    throw new Error(`createRoom failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return {
    code: response.body.code,
    playerId: response.body.playerId,
    playerToken: response.body.playerToken,
  };
}

export async function joinRoomViaApi(
  context: TestContext,
  code: string,
  name: string,
  avatarSeed = 0,
): Promise<TestPlayer> {
  const response = await api<{ code: string; playerId: string; playerToken: string }>(
    context.baseUrl,
    `/api/rooms/${code}/join`,
    { body: { name, avatarSeed } },
  );
  if (response.status !== 201) {
    throw new Error(`joinRoom failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return {
    code: response.body.code,
    playerId: response.body.playerId,
    playerToken: response.body.playerToken,
  };
}

/** Latest state per socket, so waitForState never misses a state that already arrived. */
const latestStates = new WeakMap<ClientSocket, RoomState>();

export function getLatestState(socket: ClientSocket): RoomState | undefined {
  return latestStates.get(socket);
}

export function connectPlayer(context: TestContext, player: TestPlayer): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(context.baseUrl, {
      auth: {
        code: player.code,
        playerId: player.playerId,
        playerToken: player.playerToken,
      },
      transports: ['websocket'],
      reconnection: false,
      timeout: 4000,
    });
    socket.on('room:state', (state: RoomState) => latestStates.set(socket, state));
    const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      player.socket = socket;
      // Request a fresh state snapshot so tests never race the initial broadcast.
      emitWithAck(socket, 'room:join')
        .catch(() => undefined)
        .finally(() => resolve(socket));
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function waitForState(
  socket: ClientSocket,
  predicate: (state: RoomState) => boolean,
  timeoutMs = 8000,
): Promise<RoomState> {
  const current = latestStates.get(socket);
  if (current && predicate(current)) {
    return Promise.resolve(current);
  }
  return new Promise((resolve, reject) => {
    const onState = (state: RoomState) => {
      latestStates.set(socket, state);
      if (predicate(state)) {
        clearTimeout(timer);
        socket.off('room:state', onState);
        resolve(state);
      }
    };
    const timer = setTimeout(() => {
      socket.off('room:state', onState);
      reject(new Error('Timed out waiting for room state'));
    }, timeoutMs);
    socket.on('room:state', onState);
  });
}

export function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event);
      reject(new Error(`Timed out waiting for event ${event}`));
    }, timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export function emitWithAck<T = unknown>(
  socket: ClientSocket,
  event: string,
  payload: Record<string, unknown> = {},
): Promise<{ ok: boolean; data?: T; code?: string; message?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timed out for ${event}`)), 5000);
    socket.emit(event, payload, (result: { ok: boolean }) => {
      clearTimeout(timer);
      resolve(result as { ok: boolean });
    });
  });
}

export function makeContent(contentId: string, kind: ActionKind = 'like'): ContentItem {
  return {
    provider: 'mock',
    kind,
    contentId,
    title: `clip ${contentId}`,
    coverUrl: null,
    webUrl: null,
    authorName: '@demo',
    createdAt: 0,
  };
}

export function makeEngineDeps(
  clock: { value: number },
  timingsMs = 1000,
): EngineDeps {
  return {
    now: () => clock.value,
    rng: mulberry32(99),
    timings: {
      introMs: timingsMs,
      contentMs: timingsMs,
      lockMs: timingsMs,
      revealMs: timingsMs,
      pointsMs: timingsMs,
    },
  };
}

export function engineSettings(patch: Partial<GameSettings> = {}): GameSettings {
  return {
    ...DEFAULT_SETTINGS,
    roundCount: 3,
    secondsPerRound: 15,
    enabledModes: ['who_liked'],
    randomMix: false,
    scoringMode: 'casual',
    randomizeOrder: false,
    showAvatars: true,
    ...patch,
  };
}
