type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let minimumLevel: Level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
let jsonOutput = process.env.NODE_ENV === 'production';

export function setLogLevel(level: Level): void {
  minimumLevel = level;
}

export function setJsonLogs(enabled: boolean): void {
  jsonOutput = enabled;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

function emit(level: Level, scope: string, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) return;
  if (jsonOutput) {
    process.stdout.write(
      `${JSON.stringify({ ts: new Date().toISOString(), level, scope, message, ...meta })}\n`,
    );
    return;
  }
  const time = new Date().toISOString().slice(11, 19);
  const metaText = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  process.stdout.write(`${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${metaText}\n`);
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, meta) => emit('debug', scope, message, meta),
    info: (message, meta) => emit('info', scope, message, meta),
    warn: (message, meta) => emit('warn', scope, message, meta),
    error: (message, meta) => emit('error', scope, message, meta),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}
