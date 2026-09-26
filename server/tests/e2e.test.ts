import { describe, expect, it } from 'vitest';
import type { Socket as ClientSocket } from 'socket.io-client';
import { io as ioClient } from 'socket.io-client';
import type { GuessResult, RoomState } from '@cluecrew/shared';
import {
  connectPlayer,
  createRoomViaApi,
  createTestContext,
  emitWithAck,
  joinRoomViaApi,
  waitForEvent,
  waitForState,
  type TestContext,
  type TestPlayer,
} from './helpers.js';

interface SetupResult {
  code: string;
  sockets: ClientSocket[];
  players: TestPlayer[];
}

async function setupGame(
  ctx: TestContext,
  names: string[],
  settings: Record<string, unknown>,
): Promise<SetupResult> {
  const host = await createRoomViaApi(ctx, names[0]!);
  const players = [host];
  for (const name of names.slice(1)) {
    players.push(await joinRoomViaApi(ctx, host.code, name));
  }
  const sockets: ClientSocket[] = [];
  for (const player of players) {
    sockets.push(await connectPlayer(ctx, player));
  }
  const ack = await emitWithAck(sockets[0]!, 'host:settings', { settings });
  expect(ack.ok).toBe(true);
  return { code: host.code, sockets, players };
}

function enableAutoGuess(socket: ClientSocket): void {
  socket.on('room:state', (state: RoomState) => {
    const me = state.you;
    if (!me || !state.round) return;
    if (state.phase !== 'GUESSING' || !me.canGuess || me.hasGuessed) return;
    const target = state.players.find((player) => player.id !== me.playerId && player.connected);
    if (!target) return;
    socket.emit('guess:submit', { targetPlayerId: target.id });
  });
}

interface RevealedRound {
  roundNumber: number;
  actorPlayerId: string;
  results: GuessResult[];
  actorBonus: number;
}

function collectRevealedRounds(socket: ClientSocket): RevealedRound[] {
  const rounds: RevealedRound[] = [];
  socket.on('room:state', (state: RoomState) => {
    if (state.phase !== 'REVEAL' || !state.round?.results || !state.round.actorPlayerId) return;
    if (rounds.some((round) => round.roundNumber === state.round!.roundNumber)) return;
    rounds.push({
      roundNumber: state.round.roundNumber,
      actorPlayerId: state.round.actorPlayerId,
      results: state.round.results,
      actorBonus: state.round.actorBonus ?? 0,
    });
  });
  return rounds;
}

describe('end-to-end multiplayer game', () => {
  it('plays a complete 3-round game across three players and persists the results', async () => {
    const ctx = await createTestContext();
    try {
      const { sockets } = await setupGame(ctx, ['Host', 'Bea', 'Cyd'], {
        roundCount: 3,
        scoringMode: 'casual',
        secondsPerRound: 30,
        randomMix: false,
        enabledModes: ['who_liked'],
      });
      const revealed = collectRevealedRounds(sockets[0]!);
      sockets.forEach(enableAutoGuess);

      const start = await emitWithAck(sockets[0]!, 'host:start');
      expect(start.ok).toBe(true);

      const finalStates = await Promise.all(
        sockets.map((socket) => waitForState(socket, (state) => state.phase === 'GAME_OVER', 20_000)),
      );

      for (const state of finalStates) {
        expect(state.leaderboard).toHaveLength(3);
        expect(state.roundNumber).toBe(3);
        expect(state.round?.actorPlayerId).toBeTruthy();
      }
      expect(finalStates[1]!.leaderboard.map((entry) => entry.score)).toEqual(
        finalStates[0]!.leaderboard.map((entry) => entry.score),
      );

      // Every round must be internally consistent: 100 per correct guess, no speed
      // bonus in casual mode, actor bonus per correct guesser.
      expect(revealed).toHaveLength(3);
      for (const round of revealed) {
        const correctCount = round.results.filter((result) => result.correct).length;
        expect(round.actorBonus).toBe(30 * correctCount);
        for (const result of round.results) {
          expect(result.points).toBe(result.correct ? 100 : 0);
          expect(result.bonus).toBe(0);
        }
      }

      // Leaderboard totals must equal the points awarded per round.
      const expected = new Map<string, number>();
      for (const round of revealed) {
        for (const result of round.results) {
          expected.set(
            result.playerId,
            (expected.get(result.playerId) ?? 0) + result.points + result.bonus,
          );
        }
        expected.set(
          round.actorPlayerId,
          (expected.get(round.actorPlayerId) ?? 0) + round.actorBonus,
        );
      }
      for (const entry of finalStates[0]!.leaderboard) {
        expect(entry.score).toBe(expected.get(entry.playerId) ?? 0);
      }

      // Database persistence.
      const gameRow = ctx.db
        .prepare('SELECT id, status, round_count AS roundCount FROM games')
        .get() as { id: string; status: string; roundCount: number };
      expect(gameRow.roundCount).toBe(3);
      expect(gameRow.status).toBe('finished');
      expect(ctx.repos.rounds.listForGame(gameRow.id)).toHaveLength(3);

      const guessRow = ctx.db.prepare('SELECT COUNT(*) AS c FROM guesses').get() as { c: number };
      expect(Number(guessRow.c)).toBe(revealed.length * 2);

      const totals = ctx.repos.scores.totalsForGame(gameRow.id);
      const totalsByPlayer = new Map(totals.map((row) => [row.playerId, row.points]));
      for (const entry of finalStates[0]!.leaderboard) {
        expect(totalsByPlayer.get(entry.playerId) ?? 0).toBe(entry.score);
      }

      // Play again keeps everyone connected and starts a fresh game.
      const playAgain = await emitWithAck(sockets[0]!, 'host:playAgain');
      expect(playAgain.ok).toBe(true);
      const restarted = await waitForState(
        sockets[1]!,
        (state) => state.gameNumber === 2 && state.phase !== 'GAME_OVER' && state.roundNumber >= 1,
        15_000,
      );
      expect(restarted.gameNumber).toBe(2);
      expect(restarted.leaderboard.every((entry) => entry.score === 0)).toBe(true);

      // Stop the second game so no timers outlive the test.
      await emitWithAck(sockets[0]!, 'host:end');
    } finally {
      await ctx.close();
    }
  });

  it('runs unlimited rounds until the host ends the game', async () => {
    const ctx = await createTestContext();
    try {
      const { sockets } = await setupGame(ctx, ['Host', 'Bea'], {
        roundCount: 0,
        scoringMode: 'casual',
        secondsPerRound: 30,
        randomMix: true,
        enabledModes: ['who_liked', 'who_saved', 'who_reposted', 'who_posted'],
      });
      sockets.forEach(enableAutoGuess);

      const start = await emitWithAck(sockets[0]!, 'host:start');
      expect(start.ok).toBe(true);

      await waitForState(sockets[0]!, (state) => state.roundNumber >= 6, 25_000);
      const end = await emitWithAck(sockets[0]!, 'host:end');
      expect(end.ok).toBe(true);

      const finals = await Promise.all(
        sockets.map((socket) => waitForState(socket, (state) => state.phase === 'GAME_OVER', 10_000)),
      );
      expect(finals[0]!.roundNumber).toBeGreaterThanOrEqual(6);
      expect(finals[0]!.totalRounds).toBe(0);

      const gameRow = ctx.db.prepare('SELECT status FROM games').get() as { status: string };
      expect(gameRow.status).toBe('finished');
    } finally {
      await ctx.close();
    }
  });

  it('lets a disconnected player rejoin mid-game with their answer intact', async () => {
    const ctx = await createTestContext();
    try {
      const { sockets, players } = await setupGame(ctx, ['Host', 'Bea', 'Cyd'], {
        roundCount: 5,
        scoringMode: 'casual',
        secondsPerRound: 60,
        randomMix: false,
        enabledModes: ['who_liked'],
      });

      const start = await emitWithAck(sockets[0]!, 'host:start');
      expect(start.ok).toBe(true);

      const guessingStates = await Promise.all(
        sockets.map((socket) => waitForState(socket, (state) => state.phase === 'GUESSING')),
      );
      const guesserIndex = guessingStates.findIndex((state) => state.you && !state.you.isActor);
      expect(guesserIndex).toBeGreaterThanOrEqual(0);
      const guesserState = guessingStates[guesserIndex]!;
      const guesserSocket = sockets[guesserIndex]!;
      const firstRoundNumber = guesserState.round!.roundNumber;
      const target = guesserState.players.find(
        (player) => player.id !== guesserState.you!.playerId,
      )!;
      await emitWithAck(guesserSocket, 'guess:submit', { targetPlayerId: target.id });

      // The player drops offline (their answer stays recorded) and reconnects
      // while the round is still open.
      guesserSocket.disconnect();
      const reconnected = await connectPlayer(ctx, players[guesserIndex]!);
      const reconnectedState = await waitForState(
        reconnected,
        (state) =>
          state.you?.playerId === players[guesserIndex]!.playerId &&
          state.round?.roundNumber === firstRoundNumber &&
          state.phase === 'GUESSING',
        10_000,
      );
      expect(reconnectedState.you?.hasGuessed).toBe(true);
      expect(reconnectedState.you?.guessTargetId).toBe(target.id);
      expect(
        reconnectedState.players.find(
          (player) => player.id === players[guesserIndex]!.playerId,
        )?.connected,
      ).toBe(true);

      // The game continues: the remaining guessers answer and the round reveals.
      for (const [index, socket] of sockets.entries()) {
        if (index === guesserIndex) continue;
        const state = guessingStates[index]!;
        if (state.you?.isActor) continue;
        const otherTarget = state.players.find((player) => player.id !== state.you!.playerId)!;
        await emitWithAck(socket, 'guess:submit', { targetPlayerId: otherTarget.id });
      }
      await waitForState(
        reconnected,
        (state) => state.phase === 'REVEAL' || state.phase === 'SHOW_POINTS',
        10_000,
      );
      reconnected.disconnect();
    } finally {
      await ctx.close();
    }
  });

  it('transfers host rights when the host disconnects and the game keeps working', async () => {
    const ctx = await createTestContext({ hostTransferGraceMs: 150 });
    try {
      const { sockets, players } = await setupGame(ctx, ['Host', 'Bea'], {
        roundCount: 5,
        scoringMode: 'casual',
        secondsPerRound: 60,
        randomMix: false,
        enabledModes: ['who_liked'],
      });
      enableAutoGuess(sockets[0]!);
      enableAutoGuess(sockets[1]!);
      await emitWithAck(sockets[0]!, 'host:start');
      await waitForState(sockets[1]!, (state) => state.roundNumber >= 1, 10_000);

      sockets[0]!.disconnect();
      const transferred = await waitForState(
        sockets[1]!,
        (state) => state.hostPlayerId === players[1]!.playerId,
        8_000,
      );
      expect(transferred.players.find((player) => player.id === players[1]!.playerId)!.isHost).toBe(
        true,
      );

      // The new host has full rights: ending the game works.
      const end = await emitWithAck(sockets[1]!, 'host:end');
      expect(end.ok).toBe(true);
      const finalState = await waitForState(
        sockets[1]!,
        (state) => state.phase === 'GAME_OVER' || state.status === 'lobby',
        8_000,
      );
      expect(['GAME_OVER', 'WAITING_FOR_PLAYERS']).toContain(finalState.phase);
    } finally {
      await ctx.close();
    }
  });

  it('continues cleanly when a player leaves mid-game', async () => {
    const ctx = await createTestContext();
    try {
      const { sockets } = await setupGame(ctx, ['Host', 'Bea', 'Cyd'], {
        roundCount: 5,
        scoringMode: 'casual',
        secondsPerRound: 60,
        randomMix: false,
        enabledModes: ['who_liked'],
      });
      sockets.forEach(enableAutoGuess);
      await emitWithAck(sockets[0]!, 'host:start');
      await waitForState(sockets[0]!, (state) => state.roundNumber >= 1, 10_000);

      const leaveAck = await emitWithAck(sockets[2]!, 'room:leave');
      expect(leaveAck.ok).toBe(true);
      sockets[2]!.disconnect();

      const state = await waitForState(
        sockets[0]!,
        (candidate) => candidate.players.length === 2,
        8_000,
      );
      expect(state.players).toHaveLength(2);
      await waitForState(
        sockets[0]!,
        (candidate) => candidate.phase === 'REVEAL' || candidate.phase === 'SHOW_POINTS',
        10_000,
      );
      expect(state.players.some((player) => player.id === state.you?.playerId)).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('rejects sockets with invalid player tokens', async () => {
    const ctx = await createTestContext();
    try {
      const host = await createRoomViaApi(ctx, 'Host');
      const socket = ioClient(ctx.baseUrl, {
        auth: { code: host.code, playerId: host.playerId, playerToken: 'forged-token' },
        transports: ['websocket'],
        reconnection: false,
        timeout: 3000,
      });
      const error = await new Promise<Error>((resolve) => {
        socket.once('connect_error', (err) => resolve(err));
        socket.once('connect', () => resolve(new Error('unexpected connect')));
      });
      expect(error.message).toMatch(/SOCKET_AUTH_FAILED|auth_failed/);
      socket.disconnect();
    } finally {
      await ctx.close();
    }
  });
});
