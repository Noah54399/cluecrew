#!/usr/bin/env node
/**
 * Full-stack smoke test:
 *   1. starts the real server (in-memory database, serving the built client)
 *   2. waits for /api/health
 *   3. plays a complete multiplayer game with simulated players over HTTP + WebSockets
 *   4. verifies the SPA is served
 *   5. shuts the server down and reports pass/fail
 *
 * Usage: node scripts/smoke.mjs [rounds] [players]
 *   SMOKE_MODE=prod uses the built server bundle (server/dist/server.mjs),
 *   otherwise the dev server (tsx) is used.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rounds = process.argv[2] ?? '6';
const players = process.argv[3] ?? '3';
const port = process.env.SMOKE_PORT ?? '3100';
const baseUrl = `http://127.0.0.1:${port}`;
const useProd = process.env.SMOKE_MODE === 'prod';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const commonEnv = {
  ...process.env,
  SERVE_CLIENT: 'true',
  PORT: port,
  DATABASE_PATH: ':memory:',
  // Fast phase timings so the smoke test finishes quickly.
  GAME_INTRO_MS: '300',
  GAME_CONTENT_MS: '500',
  GAME_LOCK_MS: '300',
  GAME_REVEAL_MS: '800',
  GAME_POINTS_MS: '800',
};

const server = useProd
  ? spawn(process.execPath, ['dist/server.mjs'], {
      cwd: path.join(root, 'server'),
      env: {
        ...commonEnv,
        NODE_ENV: 'production',
        // Smoke-test-only key; real deployments must provide their own secret.
        TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY ?? 'ab'.repeat(32),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  : spawn(npmCmd, ['--workspace', '@cluecrew/server', 'run', 'dev'], {
      cwd: root,
      shell: process.platform === 'win32',
      env: { ...commonEnv, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString();
});

function killServer() {
  if (server.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    server.kill('SIGTERM');
  }
}

async function waitForHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return true;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function runSimulation() {
  return new Promise((resolve) => {
    const simulation = spawn(
      process.execPath,
      [path.join(root, 'scripts', 'simulate-game.mjs'), baseUrl, rounds, players],
      { cwd: root, stdio: 'inherit' },
    );
    simulation.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  let failed = false;

  console.log('Smoke test: starting server...');
  if (!(await waitForHealth())) {
    console.error('Server did not become healthy in time.');
    console.error(serverOutput.split('\n').slice(-25).join('\n'));
    failed = true;
  }

  if (!failed) {
    const simulationCode = await runSimulation();
    if (simulationCode !== 0) {
      console.error('Simulated game failed.');
      failed = true;
    }
  }

  if (!failed) {
    const response = await fetch(baseUrl + '/');
    const html = await response.text();
    if (!response.ok || !html.includes('id="root"')) {
      console.error('Client build was not served correctly.');
      failed = true;
    } else {
      console.log('Client build served correctly at', baseUrl);
    }
  }

  killServer();
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (failed) {
    process.exit(1);
  }
  console.log('\nSmoke test passed.');
  process.exit(0);
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  killServer();
  process.exit(1);
});
