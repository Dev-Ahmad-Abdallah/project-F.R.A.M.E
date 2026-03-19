type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  service: string;
  [key: string]: unknown;
}

const SERVICE_NAME = 'frame-homeserver';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = IS_PRODUCTION ? 'info' : 'debug';

function shouldLog(level: LogLevel): boolean {
  const levelMap = new Map(Object.entries(LEVEL_PRIORITY));
  return (levelMap.get(level) ?? 0) >= (levelMap.get(MIN_LEVEL) ?? 0);
}

function formatEntry(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    service: SERVICE_NAME,
    ...meta,
  };

  if (IS_PRODUCTION) {
    return JSON.stringify(entry);
  }

  // Development: pretty-printed for readability
  return JSON.stringify(entry, null, 2);
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const output = formatEntry(level, message, meta);

  switch (level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    case 'debug':
      console.info(output); // eslint: debug not in allow list, use info
      break;
    default:
      console.info(output);
      break;
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
};
