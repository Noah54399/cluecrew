import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { BRAND } from '@cluecrew/shared';
import type { ServerConfig } from './config.js';
import type { Repositories } from './database/repositories.js';
import type { SessionService } from './auth/sessions.js';
import type { TikTokOAuthService } from './auth/tiktokOAuth.js';
import type { RoomManager } from './game/roomManager.js';
import type { DataPortabilityService } from './portability/DataPortabilityService.js';
import { createLogger } from './lib/logger.js';
import {
  corsMiddleware,
  errorHandler,
  notFoundHandler,
  originGuard,
  requestLogger,
  securityHeaders,
} from './lib/http.js';
import { createApiRouter } from './api/routes.js';
import { createMediaRouter } from './api/media.js';

export interface AppDeps {
  config: ServerConfig;
  repos: Repositories;
  sessions: SessionService;
  oauth: TikTokOAuthService;
  roomManager: RoomManager;
  dataPortability: DataPortabilityService | null;
}

export function createApp(deps: AppDeps): Express {
  const { config } = deps;
  const logger = createLogger('http');
  const app = express();

  app.disable('x-powered-by');
  if (config.isProduction) app.set('trust proxy', 1);

  app.use(securityHeaders(config));
  app.use(requestLogger(logger));

  // Public health endpoint for hosting platforms (no secrets, no auth).
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'cluecrew',
      version: config.appVersion,
      uptimeSeconds: Math.round(process.uptime()),
      dataPortability: deps.dataPortability?.enabled ?? false,
    });
  });

  app.use(corsMiddleware(config));
  app.use(express.json({ limit: '64kb' }));
  app.use(originGuard(config));

  app.use('/api', createApiRouter(deps));
  app.use('/api', createMediaRouter(config));

  const clientDist = config.clientDistPath;
  if (config.serveClient && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
    logger.info('Serving client build', { clientDist });
  }

  app.use(notFoundHandler(logger));
  app.use(errorHandler(logger));

  return app;
}
