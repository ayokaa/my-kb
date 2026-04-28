import { mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { appendFileSync, mkdirSync } from 'fs';

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

function getTodayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export class Logger {
  private buffer: LogEntry[] = [];
  private readonly bufferMaxSize = 1000;
  private seq = 0;
  private logDir: string;
  private currentFile = '';
  private currentDate = '';
  private callbacks: NewLogCallback[] = [];
  private consolePatched = false;

  constructor(logDir?: string) {
    this.logDir = logDir || join(process.cwd(), getKnowledgeRoot(), 'meta', 'logs');
    try {
      mkdirSync(this.logDir, { recursive: true });
    } catch {
      // ignore
    }
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
    const cutoffStr = cutoff.toISOString().split('T')[0];

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
    return {
      id: `${now.toISOString()}-${String(this.seq).padStart(6, '0')}`,
      timestamp: now.toISOString(),
      level,
      module,
      message,
      metadata,
    };
  }

  private write(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.bufferMaxSize) {
      this.buffer.shift();
    }

    this.rotateIfNeeded();

    const line = JSON.stringify(entry) + '\n';
    if (this.currentFile) {
      try {
        appendFileSync(this.currentFile, line);
      } catch {
        // ignore file write errors
      }
    }

    for (const cb of this.callbacks) {
      try {
        cb(entry);
      } catch {
        // ignore callback errors
      }
    }
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
    const { level, module, search, limit = 100, offset = 0, from } = options;

    const filtered: LogEntry[] = [];
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const e = this.buffer[i];

      if (level) {
        const levels = Array.isArray(level) ? level : [level];
        if (!levels.includes(e.level)) continue;
      }
      if (module && e.module !== module) continue;
      if (search && !e.message.toLowerCase().includes(search.toLowerCase())) continue;
      if (from && e.timestamp < from) continue;

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

  patchConsole(): void {
    if (this.consolePatched) return;
    this.consolePatched = true;

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const self = this;

    console.log = (...args: unknown[]) => {
      originalLog.apply(console, args);
      const mod = detectModule(args);
      self.info(mod, formatArgs(args));
    };

    console.warn = (...args: unknown[]) => {
      originalWarn.apply(console, args);
      const mod = detectModule(args);
      self.warn(mod, formatArgs(args));
    };

    console.error = (...args: unknown[]) => {
      originalError.apply(console, args);
      const mod = detectModule(args);
      self.error(mod, formatArgs(args));
    };
  }

  close(): void {
    // No-op: appendFileSync does not hold open file handles
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

// Global singleton
export const logger = new Logger();

export function getLogger(): Logger {
  return logger;
}

export function patchConsole(): void {
  logger.patchConsole();
}

// Graceful shutdown: file handles are managed per-write (appendFileSync),
// so no global process listeners are needed here.
