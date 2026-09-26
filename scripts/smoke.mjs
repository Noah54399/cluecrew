#!/usr/bin/env node
/**
 * Full-stack smoke test.
 *
 *   node scripts/smoke.mjs                       # starts the built server locally and checks it
 *   node scripts/smoke.mjs --url https://…       # checks a deployed instance instead
 *
 * ClueCrew serves REAL TikTok data only, so a complete game requires players
 * with connected TikTok accounts. The automated test suite covers full games
 * (with an injected test provider); this smoke test verifies everything that
 * does not need live TikTok credentials:
 *   health, built client, secret-free config, cookies, CORS, room create/join,
 *   and the honest "no content sources" guard when nobody is connected.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const urlFlagIndex = process.argv.indexOf('--url');
const remoteUrl = urlFlagIndex !== -1 ? process.argv[urlFlagIndex + 1] : null;
const port = process.env.SMOKE_PORT ?? '3100';
const localUrl = `http://127.0.0.1:${port}`;
const base = (remoteUrl ?? localUrl).replace(/\/$/, '');
const useProd = process.env.SMOKE_MODE === 'prod';
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
  if (!ok) failures.push(name);
};

let server = null;
let serverLogs = '';

function killServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    server.kill('SIGTERM');
  }
}

async function waitForHealth(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        // Must be OUR health payload, not some other server's HTML on this port.
        const body = await response.json().catch(() => null);
        if (body?.service === 'cluecrew' && body?.status === 'ok') return true;
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function emitAck(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), 10_000);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

async function connectPlayer(baseUrl, player) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      auth: { code: player.code, playerId: player.playerId, playerToken: player.playerToken },
      transports: ['websocket'],
      timeout: 20_000,
    });
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 30_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  if (!remoteUrl) {
    console.log(`Smoke test: starting built server${useProd ? '' : ' (dev server)'}...`);
    server = useProd
      ? spawn(process.execPath, ['dist/server.mjs'], {
          cwd: path.join(root, 'server'),
          env: {
            ...process.env,
            NODE_ENV: 'production',
            PORT: port,
            TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
            DATABASE_PATH: ':memory:',
            SERVE_CLIENT: 'true',
            BACKEND_URL: localUrl,
            FRONTEND_URL: localUrl,
            ALLOWED_ORIGINS: `${localUrl},http://localhost:${port}`,
            // Dummy credentials: only makes the "configured but not connected"
            // state visible. No TikTok request happens in the smoke test.
            TIKTOK_CLIENT_KEY: 'smoke-test-key',
            TIKTOK_CLIENT_SECRET: 'smoke-test-secret',
            GAME_INTRO_MS: '300',
            GAME_CONTENT_MS: '500',
            GAME_LOCK_MS: '300',
            GAME_REVEAL_MS: '800',
            GAME_POINTS_MS: '800',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawn(npmCmd, ['--workspace', '@cluecrew/server', 'run', 'dev'], {
          cwd: root,
          shell: process.platform === 'win32',
          env: {
            ...process.env,
            NODE_ENV: 'production',
            PORT: port,
            TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
            DATABASE_PATH: ':memory:',
            SERVE_CLIENT: 'true',
            BACKEND_URL: localUrl,
            FRONTEND_URL: localUrl,
            ALLOWED_ORIGINS: `${localUrl},http://localhost:${port}`,
            TIKTOK_CLIENT_KEY: 'smoke-test-key',
            TIKTOK_CLIENT_SECRET: 'smoke-test-secret',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
    server.stdout?.on('data', (chunk) => {
      serverLogs += chunk.toString();
    });
    server.stderr?.on('data', (chunk) => {
      serverLogs += chunk.toString();
    });
    if (!(await waitForHealth(base))) {
      check('server becomes healthy', false, base);
      console.error(serverLogs.split('\n').slice(-25).join('\n'));
      return;
    }
  }

  console.log(`Checking ${base}\n`);

  // 1. Health
  const health = await fetch(`${base}/health`).then((r) => r.json());
  check('GET /health', health.status === 'ok' && health.service === 'cluecrew', JSON.stringify(health));

  // 2. Built client
  const html = await (await fetch(`${base}/`)).text();
  check('client build is served', html.includes('id="root"'));

  // 3. Public config: no secrets, scopes published
  const configText = await (await fetch(`${base}/api/config`)).text();
  const config = JSON.parse(configText);
  check(
    'GET /api/config is public-only',
    !/secret/i.test(configText) &&
      Array.isArray(config.tiktokScopes) &&
      !('mockProviderAllowed' in config),
    `tiktokConfigured=${config.tiktokConfigured} scopes=${(config.tiktokScopes ?? []).join('|')}`,
  );

  // 4. Session cookie flags
  const guest = await fetch(`${base}/api/session/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'SmokeTest' }),
  });
  const cookie = guest.headers.get('set-cookie') ?? '';
  check(
    'session cookie HttpOnly + Secure + SameSite',
    cookie.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite='),
    cookie.replace(/cluecrew_session=[^;]+/, 'cluecrew_session=<redacted>'),
  );

  // 5. CORS preflight
  const preflight = await fetch(`${base}/api/rooms`, {
    method: 'OPTIONS',
    headers: { Origin: base, 'Access-Control-Request-Method': 'POST' },
  });
  check(
    'CORS preflight for the site origin',
    preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === base,
  );

  // 6. Real-only empty state: profile without a connection
  const profile = await (await fetch(`${base}/api/tiktok/profile`, { headers: { Cookie: cookie.split(';')[0] } })).json();
  check(
    'profile endpoint returns the connect empty state',
    profile.connected === false &&
      /connect your tiktok account|not configured/i.test(String(profile.message)),
    String(profile.message),
  );

  // 7. Rooms + sockets
  const host = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'SmokeHost', avatarSeed: 0 }),
  }).then((r) => r.json());
  const guestPlayer = await fetch(`${base}/api/rooms/${host.code}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'SmokeGuest', avatarSeed: 1 }),
  }).then((r) => r.json());
  check('room created + joined', Boolean(host.code && guestPlayer.playerId), `code=${host.code}`);

  const hostSocket = await connectPlayer(base, { ...host, code: host.code });
  const guestSocket = await connectPlayer(base, { ...guestPlayer, code: host.code });

  // 8. The honest guard: no fake content, clear error when nobody is connected
  const start = await emitAck(hostSocket, 'host:start');
  check(
    'game refuses to start without real content sources',
    start?.ok === false && start?.code === 'TOO_FEW_CONTENT_SOURCES',
    `${start?.code}: ${start?.message}`,
  );

  // 9. Mode availability is reported as unavailable with reasons
  const state = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no room state')), 10_000);
    hostSocket.once('room:state', (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    hostSocket.emit('room:join', {}, () => undefined);
  });
  check(
    'all modes report unavailable (no demo fallback)',
    Array.isArray(state.modeAvailability) &&
      state.modeAvailability.every((entry) => entry.playable === false) &&
      state.availableModes.length === 0,
  );

  hostSocket.disconnect();
  guestSocket.disconnect();
}

main()
  .catch((error) => {
    check('smoke test completed without errors', false, String(error));
    if (serverLogs) console.error(serverLogs.split('\n').slice(-25).join('\n'));
  })
  .finally(async () => {
    killServer();
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log(failures.length === 0 ? '\nSmoke test passed.' : `\nSmoke test FAILED (${failures.length}).`);
    process.exit(failures.length === 0 ? 0 : 1);
  });
