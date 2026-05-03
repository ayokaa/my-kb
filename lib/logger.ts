import { mkdir, readdir, unlink, appendFile } from 'fs/promises';
import { join } from 'path';
import { mkdirSync } from 'fs';
import pino from 'pino';
import pretty from 'pino-pretty';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface LogQuery {
  level?: LogLevel | LogLevel[];
  module?: string;
  search?: string;
  limit?: number;
  offset?: number;
  from?: string;
}

export interface LogQueryResult {
  logs: LogEntry[];
  total: number;
}

type NewLogCallback = (entry: LogEntry) => void;

function getKnowledgeRoot(): string {
  return process.env.KNOWLEDGE_ROOT || 'knowledge';
}

function getTodayStr(date?: Date): string {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalISOString(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const tzOffset = -date.getTimezoneOffset(); // minutes, positive for east of UTC
  const sign = tzOffset >= 0 ? '+' : '-';
  const tzHours = pad(Math.floor(Math.abs(tzOffset) / 60));
  const tzMins = pad(Math.abs(tzOffset) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}${sign}${tzHours}:${tzMins}`
  );
}

const PINO_LEVELS: Record<LogLevel, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

// Keep references to original console methods for internal use
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

export class Logger {
  private buffer: LogEntry[] = [];
  private readonly bufferMaxSize = 1000;
  private seq = 0;
  private logDir: string;
  private currentFile = '';
  private currentDate = '';
  private callbacks: NewLogCallback[] = [];
  private consolePatched = false;
  private pendingLines: string[] = [];
  private flushInProgress = false;
  private flushRequested = false;
  private pino: pino.Logger;
  private currentLevel: LogLevel = 'info';

  constructor(logDir?: string) {
    this.logDir = logDir || join(process.cwd(), getKnowledgeRoot(), 'meta', 'logs');
    try {
      mkdirSync(this.logDir, { recursive: true });
    } catch {
      // ignore
    }

    this.pino = this.createPino();
  }

  private createPino(): pino.Logger {
    const isDev = process.env.NODE_ENV === 'development';
    const isTest = process.env.NODE_ENV === 'test';

    const pinoOpts: pino.LoggerOptions = {
      level: isTest ? 'silent' : this.currentLevel,
      base: undefined, // remove default pid/hostname
      timestamp: pino.stdTimeFunctions.isoTime,
    };

    if (isDev) {
      // Development: colorized terminal output via pino-pretty stream
      // Using stream mode avoids pino.transport() Worker Thread issues in Next.js
      return pino(
        pinoOpts,
        pretty({
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
          messageFormat: (log: Record<string, unknown>, messageKey: string) => {
            const mod = (log.module as string) || 'app';
            return `[${mod}] ${log[messageKey] as string}`;
          },
        })
      );
    }

    // Production / Test: no terminal output, level filtering only
    return pino({ ...pinoOpts, level: isTest ? 'silent' : this.currentLevel });
  }

  private rotateIfNeeded(): void {
    const today = getTodayStr();
    if (this.currentDate === today) return;

    this.currentDate = today;
    this.currentFile = join(this.logDir, `app-${today}.log`);
    try {
      mkdirSync(this.logDir, { recursive: true });
    } catch {
      // ignore
    }
    this.cleanupOldLogs().catch(() => {});
  }

  private async cleanupOldLogs(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = getTodayStr(cutoff);

    try {
      const files = await readdir(this.logDir);
      for (const file of files) {
        const match = file.match(/^app-(\d{4}-\d{2}-\d{2})\.log$/);
        if (match && match[1] < cutoffStr) {
          await unlink(join(this.logDir, file));
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }

  private createEntry(
    level: LogLevel,
    module: string,
    message: string,
    metadata?: Record<string, unknown>
  ): LogEntry {
    const now = new Date();
    this.seq = (this.seq + 1) % 1000000;

    // Auto-extract Error stack trace from metadata.error
    let msg = message;
    const meta = metadata ? { ...metadata } : undefined;
    if (meta?.error instanceof Error) {
      msg = `${message}\n${meta.error.stack || meta.error.message}`;
      delete meta.error;
    }

    return {
      id: `${toLocalISOString(now)}-${String(this.seq).padStart(6, '0')}`,
      timestamp: toLocalISOString(now),
      level,
      module,
      message: msg,
      metadata: meta,
    };
  }

  /**
   * Schedule an async flush of pending log lines to disk.
   */
  private scheduleFlush(): void {
    if (this.flushInProgress) {
      this.flushRequested = true;
      return;
    }

    this.flushInProgress = true;
    queueMicrotask(async () => {
      do {
        this.flushRequested = false;
        const lines = this.pendingLines.splice(0);
        if (lines.length > 0 && this.currentFile) {
          try {
            await appendFile(this.currentFile, lines.join(''));
          } catch {
            // ignore file write errors
          }
        }
      } while (this.flushRequested);
      this.flushInProgress = false;
    });
  }

  private shouldLog(level: LogLevel): boolean {
    return PINO_LEVELS[level] >= PINO_LEVELS[this.currentLevel];
  }

  private write(entry: LogEntry): void {
    const shouldPersist = this.shouldLog(entry.level);

    // Memory buffer: all levels, for query API
    this.buffer.push(entry);
    if (this.buffer.length > this.bufferMaxSize) {
      this.buffer.shift();
    }

    // File persistence: level-filtered
    if (shouldPersist) {
      this.rotateIfNeeded();
      const line = JSON.stringify(entry) + '\n';
      if (this.currentFile) {
        this.pendingLines.push(line);
        this.scheduleFlush();
      }

      // Pino terminal output: level-filtered
      if (process.env.NODE_ENV !== 'test') {
        this.pino[entry.level](
          { module: entry.module, id: entry.id, ...entry.metadata },
          entry.message
        );
      }
    }

    // SSE push: all levels, for real-time log panel
    for (const cb of this.callbacks) {
      try {
        cb(entry);
      } catch {
        // ignore callback errors
      }
    }
  }

  /** Change the minimum log level at runtime. */
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
    this.pino.level = level;
  }

  debug(module: string, message: string, metadata?: Record<string, unknown>): void {
    this.write(this.createEntry('debug', module, message, metadata));
  }

  info(module: string, message: string, metadata?: Record<string, unknown>): void {
    this.write(this.createEntry('info', module, message, metadata));
  }

  warn(module: string, message: string, metadata?: Record<string, unknown>): void {
    this.write(this.createEntry('warn', module, message, metadata));
  }

  error(module: string, message: string, metadata?: Record<string, unknown>): void {
    this.write(this.createEntry('error', module, message, metadata));
  }

  query(options: LogQuery = {}): LogQueryResult {
    const { level, module, search, limit = 1000, offset = 0, from } = options;

    const filtered: LogEntry[] = [];
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const e = this.buffer[i];

      if (level) {
        const levels = Array.isArray(level) ? level : [level];
        if (!levels.includes(e.level)) continue;
      }
      if (module && e.module !== module) continue;
      if (search && !e.message.toLowerCase().includes(search.toLowerCase())) continue;
      if (from && new Date(e.timestamp) < new Date(from)) continue;

      filtered.push(e);
    }

    const total = filtered.length;
    const logs = filtered.slice(offset, offset + limit);
    return { logs, total };
  }

  onNewLog(callback: NewLogCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const idx = this.callbacks.indexOf(callback);
      if (idx !== -1) this.callbacks.splice(idx, 1);
    };
  }

  clear(): void {
    this.buffer = [];
    this.seq = 0;
  }

  getLogDir(): string {
    return this.logDir;
  }

  getBuffer(): LogEntry[] {
    return [...this.buffer];
  }

  isConsolePatched(): boolean {
    return this.consolePatched;
  }

  /**
   * Replace console.log/warn/error with logger calls.
   * Note: intercepted messages are NOT printed to the original console
   * (i.e. terminal output is suppressed). This avoids duplicating logs
   * since pino already handles terminal output.
   */
  patchConsole(): void {
    if (this.consolePatched) return;
    this.consolePatched = true;

    const self = this;

    console.log = (...args: unknown[]) => {
      const mod = detectModule(args);
      self.info(mod, formatArgs(args));
    };

    console.warn = (...args: unknown[]) => {
      const mod = detectModule(args);
      self.warn(mod, formatArgs(args));
    };

    console.error = (...args: unknown[]) => {
      const mod = detectModule(args);
      self.error(mod, formatArgs(args));
    };
  }

  async close(): Promise<void> {
    // Flush any pending lines before closing
    if (this.pendingLines.length > 0) {
      this.flushRequested = false;
      const lines = this.pendingLines.splice(0);
      if (this.currentFile) {
        try {
          await appendFile(this.currentFile, lines.join(''));
        } catch {
          // ignore
        }
      }
    }
    // Wait for any in-flight flush to complete
    while (this.flushInProgress) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

function detectModule(args: unknown[]): string {
  const first = String(args[0] || '');
  const match = first.match(/^\[(\w+)\]/);
  return match ? match[1] : 'app';
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

// Global singleton — use globalThis to survive Next.js HMR / Turbopack module re-evaluation
const LOGGER_KEY = '__my_kb_logger__' as const;

function getOrCreateLogger(): Logger {
  const g = globalThis as Record<string, unknown>;
  if (!g[LOGGER_KEY]) {
    g[LOGGER_KEY] = new Logger();
  }
  return g[LOGGER_KEY] as Logger;
}

export const logger: Logger = getOrCreateLogger();

export function getLogger(): Logger {
  return logger;
}

export function patchConsole(): void {
  logger.patchConsole();
}
