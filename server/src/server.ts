import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { openAppDatabase } from './database/db.js';
import { createRepositories } from './database/repositories.js';
import { SessionService } from './auth/sessions.js';
import { TikTokOAuthService } from './auth/tiktokOAuth.js';
import { RoomManager } from './game/roomManager.js';
import { createApp } from './app.js';
import { createSocketServer } from './realtime/socket.js';
import { BRAND } from '@cluecrew/shared';
import { createLogger } from './lib/logger.js';
import { DataPortabilityService } from './portability/DataPortabilityService.js';
import { HttpTikTokDataPortabilityClient } from './portability/tiktokDataPortabilityClient.js';
import { TikTokOEmbedClient } from './portability/oembed.js';

const config = loadConfig();
const logger = createLogger('server');

const db = openAppDatabase(config);
const repos = createRepositories(db);
const sessions = new SessionService(repos, config);

const dataPortability = new DataPortabilityService({
  config,
  repos,
  client: new HttpTikTokDataPortabilityClient(),
  oEmbed: config.dataPortability.enrichWithOEmbed ? new TikTokOEmbedClient() : null,
  logger: logger.child('portability'),
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
  deps: {
    now: () => Date.now(),
    rng: () => Math.random(),
    timings: config.timings,
  },
  logger: logger.child('rooms'),
  dataPortability,
});

const app = createApp({ config, repos, sessions, oauth, roomManager, dataPortability });
const httpServer = createServer(app);
const io = createSocketServer({ httpServer, config, roomManager });
roomManager.attachIo(io);
roomManager.startSweeper();
dataPortability.cleanupTempFiles();

// Background polling of pending TikTok activity exports (TikTok prepares
// exports asynchronously; we poll instead of requiring webhooks).
const importPollTimer = setInterval(() => {
  void dataPortability.pollActiveImports();
}, config.dataPortability.pollIntervalMs);
importPollTimer.unref();

httpServer.listen(config.port, () => {
  const lines = [
    '',
    `  ${BRAND.name} server is running`,
    `  > Local:      ${config.publicUrl}`,
    `  > Client dev: ${config.clientUrl}`,
    `  > Database:   ${config.databasePath}`,
    `  > TikTok:     ${config.tiktok.configured ? 'configured' : 'not configured (mock data available: ' + config.allowMockProvider + ')'}`,
    `  > Activity:   ${dataPortability.enabled ? `import enabled (${config.dataPortability.scope})` : 'Data Portability import disabled'}`,
    `  > Demo data:  ${config.allowMockProvider ? 'allowed' : 'disabled'}`,
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
  logger.info('HTTP server listening', { port: config.port });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal} — shutting down`);
  clearInterval(importPollTimer);
  roomManager.dispose();
  io.close();
  httpServer.close(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});
