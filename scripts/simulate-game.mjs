#!/usr/bin/env node
/**
 * Simulated multiplayer game against a running ClueCrew server.
 *
 * Usage:
 *   node scripts/simulate-game.mjs [baseUrl] [rounds] [players]
 *   npm run simulate -- http://localhost:3001 5 3
 *
 * Creates a room, joins N players over real HTTP + WebSockets, plays a full
 * game with automatic guessing and prints the leaderboard. Exits non-zero if
 * the game does not complete.
 */
import { io } from 'socket.io-client';

const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const rounds = Number.parseInt(process.argv[3] ?? '5', 10);
const playerCount = Math.max(2, Number.parseInt(process.argv[4] ?? '3', 10));
const names = ['Nova', 'Bea', 'Cyd', 'Dax', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivy', 'Jax', 'Kai', 'Lex'];

async function api(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${json?.error?.message ?? text}`);
  }
  return json;
}

function connect(player) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      auth: { code: player.code, playerId: player.playerId, playerToken: player.playerToken },
      transports: ['websocket'],
      timeout: 20_000,
      reconnection: true,
      reconnectionDelay: 1000,
    });
    // Generous timeout: Render free instances cold-start in ~1 minute.
    const timer = setTimeout(() => reject(new Error('socket connect timeout after 90s')), 90_000);
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

function emitAck(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (ack) => {
      if (ack?.ok) resolve(ack.data);
      else reject(new Error(`${event} failed: ${ack?.message ?? 'unknown error'}`));
    });
  });
}

async function main() {
  console.log(`ClueCrew simulation - server ${baseUrl}, ${playerCount} players, ${rounds} rounds\n`);

  process.stdout.write('Waiting for the server (a free Render instance may need ~1 min to wake up)... ');
  const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) {
    console.error(`\nServer at ${baseUrl} is not reachable. Start it with: npm run dev`);
    process.exit(1);
  }
  console.log('ok');

  const host = await api('/api/rooms', { name: names[0], avatarSeed: 0 });
  const code = host.code;
  console.log(`Room ${code} created by ${names[0]}`);

  const players = [host];
  for (let index = 1; index < playerCount; index += 1) {
    const joined = await api(`/api/rooms/${code}/join`, { name: names[index], avatarSeed: index });
    joined.code = code;
    players.push(joined);
  }
  console.log(`${players.length} players joined: ${players.slice(0, playerCount).map((_, i) => names[i]).join(', ')}\n`);

  const sockets = [];
  for (const player of players) {
    const socket = await connect(player);
    sockets.push(socket);
  }

  let finished = false;
  let finalState = null;
  const loggedRounds = new Set();

  for (const [index, socket] of sockets.entries()) {
    socket.on('room:state', (roomState) => {
      if (roomState.phase === 'GUESSING') {
        const me = roomState.you;
        if (me?.canGuess && !me.hasGuessed) {
          const targets = roomState.players.filter(
            (player) => player.id !== me.playerId && player.connected,
          );
          const target = targets[Math.floor(Math.random() * targets.length)];
          if (target) {
            socket.emit('guess:submit', { targetPlayerId: target.id }, () => undefined);
          }
        }
      }
      if (index === 0 && roomState.round?.results && roomState.round.actorPlayerId) {
        const key = roomState.round.roundNumber;
        if (!loggedRounds.has(key)) {
          loggedRounds.add(key);
          const actor = roomState.players.find(
            (player) => player.id === roomState.round.actorPlayerId,
          );
          const correct = roomState.round.results.filter((result) => result.correct).length;
          const answered = roomState.round.results.filter(
            (result) => result.answeredAt !== null,
          ).length;
          console.log(
            `Round ${key}: ${roomState.round.modeTitle} - answer was ${actor?.name ?? '?'} (${correct}/${answered} correct)`,
          );
        }
      }
      if (roomState.phase === 'GAME_OVER') {
        finished = true;
        finalState = roomState;
      }
    });
    if (index === 0) {
      socket.on('room:toast', (toast) => {
        console.log(`  [toast] ${toast.message}`);
      });
      socket.on('room:error', (error) => console.error(`  [error] ${error.message}`));
    }
  }

  await emitAck(sockets[0], 'host:settings', {
    settings: {
      roundCount: rounds,
      secondsPerRound: 15,
      randomMix: true,
      scoringMode: 'classic',
      enabledModes: ['who_liked', 'who_reposted', 'who_saved', 'who_posted'],
    },
  });
  await emitAck(sockets[0], 'host:start');
  console.log('Game started...\n');

  const deadline = Date.now() + 120_000;
  while (!finished && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (!finished || !finalState) {
    console.error('\nGame did not finish within 120 seconds.');
    for (const socket of sockets) socket.disconnect();
    process.exit(1);
  }

  console.log('\nFinal leaderboard');
  console.log('-----------------');
  for (const entry of finalState.leaderboard) {
    console.log(
      `${String(entry.rank).padStart(2)}. ${entry.name.padEnd(12)} ${String(entry.score).padStart(5)} points  (${entry.correctGuesses} correct guesses)`,
    );
  }
  console.log(`\nRounds played: ${loggedRounds.size} - game completed successfully.`);

  // Reconnection check: drop a player and bring them back with the same credentials.
  const reconnectPlayer = players[1];
  sockets[1].disconnect();
  await new Promise((resolve) => setTimeout(resolve, 600));
  try {
    const revived = await connect(reconnectPlayer);
    const reconnectedState = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no room state after reconnect')), 15_000);
      revived.on('room:state', (state) => {
        clearTimeout(timer);
        resolve(state);
      });
    });
    const reconnectedOk = reconnectedState?.you?.playerId === reconnectPlayer.playerId;
    console.log(
      `${reconnectedOk ? 'PASS' : 'FAIL'}  Reconnect: ${names[1]} rejoined with their state after a drop`,
    );
    revived.disconnect();
    if (!reconnectedOk) process.exitCode = 1;
  } catch (error) {
    console.log(`FAIL  Reconnect: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }

  for (const socket of sockets) socket.disconnect();
  process.exit(process.exitCode ?? 0);
}

main().catch((error) => {
  console.error(`Simulation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
