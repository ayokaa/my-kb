import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Logger, LogEntry } from '../logger';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Logger', () => {
  let tmpDir: string;
  let logger: Logger;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kb-logger-test-'));
    logger = new Logger(tmpDir);
  });

  afterEach(async () => {
    await logger.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('level methods', () => {
    it('writes info log', () => {
      logger.info('Test', 'hello world');
      const result = logger.query();
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].level).toBe('info');
      expect(result.logs[0].module).toBe('Test');
      expect(result.logs[0].message).toBe('hello world');
      expect(result.logs[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('writes debug log', () => {
      logger.setLevel('debug');
      logger.debug('DebugMod', 'debug msg');
      const result = logger.query();
      expect(result.logs[0].level).toBe('debug');
    });

    it('writes warn log', () => {
      logger.warn('WarnMod', 'warn msg');
      const result = logger.query();
      expect(result.logs[0].level).toBe('warn');
    });

    it('writes error log', () => {
      logger.error('ErrMod', 'error msg');
      const result = logger.query();
      expect(result.logs[0].level).toBe('error');
    });

    it('includes metadata', () => {
      logger.info('Meta', 'with meta', { key: 'value', num: 42 });
      const result = logger.query();
      expect(result.logs[0].metadata).toEqual({ key: 'value', num: 42 });
    });
  });

  describe('ring buffer', () => {
    it('keeps only the most recent 1000 entries', () => {
      for (let i = 0; i < 1100; i++) {
        logger.info('Buffer', `msg ${i}`);
      }
      const result = logger.query({ limit: 2000 });
      expect(result.total).toBe(1000);
      expect(result.logs[0].message).toBe('msg 1099');
      expect(result.logs[999].message).toBe('msg 100');
    });
  });

  describe('query filtering', () => {
    beforeEach(() => {
      logger.setLevel('debug');
      logger.debug('A', 'alpha debug');
      logger.info('A', 'alpha info');
      logger.warn('B', 'beta warn');
      logger.error('B', 'beta error');
      logger.info('C', 'gamma info');
    });

    it('filters by single level', () => {
      const result = logger.query({ level: 'error' });
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].message).toBe('beta error');
    });

    it('filters by multiple levels', () => {
      const result = logger.query({ level: ['warn', 'error'] });
      expect(result.logs).toHaveLength(2);
      expect(result.logs[0].message).toBe('beta error');
      expect(result.logs[1].message).toBe('beta warn');
    });

    it('filters by module', () => {
      const result = logger.query({ module: 'A' });
      expect(result.logs).toHaveLength(2);
      expect(result.logs.every((e) => e.module === 'A')).toBe(true);
    });

    it('filters by search keyword (case insensitive)', () => {
      const result = logger.query({ search: 'BETA' });
      expect(result.logs).toHaveLength(2);
    });

    it('filters by from timestamp', () => {
      const midpoint = logger.query().logs[2].timestamp;
      const result = logger.query({ from: midpoint });
      // Only entries with timestamp >= midpoint
      expect(result.logs.length).toBeGreaterThanOrEqual(1);
      expect(result.logs.every((e) => e.timestamp >= midpoint)).toBe(true);
    });

    it('supports limit and offset', () => {
      const all = logger.query({ limit: 100 });
      expect(all.logs).toHaveLength(5);

      const page1 = logger.query({ limit: 2, offset: 0 });
      expect(page1.logs).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = logger.query({ limit: 2, offset: 2 });
      expect(page2.logs).toHaveLength(2);
      // page2 should continue where page1 left off
      expect(page2.logs[0].message).toBe('beta warn');
    });

    it('returns results ordered newest first', () => {
      const result = logger.query({ limit: 100 });
      expect(result.logs[0].message).toBe('gamma info');
      expect(result.logs[4].message).toBe('alpha debug');
    });
  });

  describe('onNewLog callback', () => {
    it('notifies listeners on new log', () => {
      const received: LogEntry[] = [];
      const unsubscribe = logger.onNewLog((entry) => received.push(entry));

      logger.info('CB', 'callback test');
      expect(received).toHaveLength(1);
      expect(received[0].message).toBe('callback test');

      unsubscribe();
      logger.info('CB', 'after unsub');
      expect(received).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('removes all buffered logs', () => {
      logger.info('X', 'one');
      logger.info('X', 'two');
      expect(logger.query().total).toBe(2);
      logger.clear();
      expect(logger.query().total).toBe(0);
    });
  });

  describe('file persistence', () => {
    it('writes logs to daily file', async () => {
      logger.info('File', 'persisted');
      await logger.close();

      const today = new Date().toISOString().split('T')[0];
      const filePath = join(tmpDir, `app-${today}.log`);
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('persisted');
    });
  });

  describe('setLevel and filtering', () => {
    it('default level is info: debug not persisted to file', async () => {
      const fresh = new Logger(tmpDir);
      fresh.debug('Lvl', 'debug msg');
      fresh.info('Lvl', 'info msg');
      await fresh.close();

      const today = new Date().toISOString().split('T')[0];
      const content = readFileSync(join(tmpDir, `app-${today}.log`), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).message).toBe('info msg');
      await fresh.close();
    });

    it('buffer captures all levels regardless of currentLevel', () => {
      // default level is info
      logger.debug('Lvl', 'debug should be in buffer');
      logger.info('Lvl', 'info msg');
      const result = logger.query({ limit: 100 });
      expect(result.total).toBe(2);
      expect(result.logs.find((e) => e.level === 'debug')).toBeDefined();
    });

    it('SSE callbacks receive all levels regardless of currentLevel', () => {
      const received: LogEntry[] = [];
      logger.onNewLog((entry) => received.push(entry));

      logger.debug('Lvl', 'debug callback');
      logger.info('Lvl', 'info callback');
      expect(received).toHaveLength(2);
      expect(received[0].level).toBe('debug');
      expect(received[1].level).toBe('info');
    });

    it('switching to debug level persists previously skipped levels', async () => {
      const fresh = new Logger(tmpDir);
      fresh.debug('Lvl', 'before switch — not persisted');
      fresh.setLevel('debug');
      fresh.debug('Lvl', 'after switch — persisted');
      await fresh.close();

      const today = new Date().toISOString().split('T')[0];
      const content = readFileSync(join(tmpDir, `app-${today}.log`), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).message).toBe('after switch — persisted');
      await fresh.close();
    });

    it('switching to warn level filters out info', async () => {
      const fresh = new Logger(tmpDir);
      fresh.setLevel('warn');
      fresh.info('Lvl', 'info should not persist');
      fresh.warn('Lvl', 'warn should persist');
      fresh.error('Lvl', 'error should persist');
      await fresh.close();

      const today = new Date().toISOString().split('T')[0];
      const content = readFileSync(join(tmpDir, `app-${today}.log`), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const levels = lines.map((l) => JSON.parse(l).level);
      expect(levels.sort()).toEqual(['error', 'warn']);
      // buffer still has all 3
      expect(fresh.query().total).toBe(3);
      await fresh.close();
    });
  });

  describe('Error stack extraction', () => {
    it('auto-extracts Error stack from metadata.error', () => {
      const err = new Error('boom');
      logger.error('Err', 'something failed', { error: err });
      const entry = logger.query().logs[0];
      expect(entry.message).toContain('something failed');
      expect(entry.message).toContain('boom');
      expect(entry.message).toContain('Error: boom');
      // Error object should be removed from metadata
      expect(entry.metadata?.error).toBeUndefined();
    });

    it('preserves other metadata fields alongside error', () => {
      const err = new Error('fail');
      logger.error('Err', 'with extra', { error: err, requestId: 'abc-123' });
      const entry = logger.query().logs[0];
      expect(entry.metadata?.requestId).toBe('abc-123');
      expect(entry.metadata?.error).toBeUndefined();
      expect(entry.message).toContain('Error: fail');
    });

    it('does not modify message when no error in metadata', () => {
      logger.info('Err', 'plain message', { key: 'val' });
      const entry = logger.query().logs[0];
      expect(entry.message).toBe('plain message');
    });

    it('does not modify message when error is not an Error instance', () => {
      logger.error('Err', 'string error', { error: 'not an Error' });
      const entry = logger.query().logs[0];
      expect(entry.message).toBe('string error');
      expect(entry.metadata?.error).toBe('not an Error');
    });
  });

  describe('toLocalISOString format', () => {
    it('produces ISO 8601 with timezone offset', () => {
      logger.info('Time', 'ts test');
      const entry = logger.query().logs[0];
      // Should match: 2026-05-01T20:30:00.123+08:00 or -05:00
      expect(entry.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/
      );
    });

    it('timestamp is parseable by Date constructor', () => {
      logger.info('Time', 'parse test');
      const entry = logger.query().logs[0];
      const parsed = new Date(entry.timestamp);
      expect(parsed.getTime()).not.toBeNaN();
    });

    it('entry id contains the same timestamp', () => {
      logger.info('Time', 'id test');
      const entry = logger.query().logs[0];
      // id format: <timestamp>-<6-digit-seq>
      expect(entry.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}-\d{6}$/);
      expect(entry.id.startsWith(entry.timestamp)).toBe(true);
    });
  });

  describe('patchConsole', () => {
    it('intercepts console calls with module detection', () => {
      logger.patchConsole();
      expect(logger.isConsolePatched()).toBe(true);

      // Since patchConsole also calls the original console,
      // we verify by checking the logger buffer directly.
      const beforeCount = logger.query().total;

      console.log('[Queue] test message from console');
      const after = logger.query();
      expect(after.total).toBe(beforeCount + 1);

      const found = after.logs.find(
        (e) => e.module === 'Queue' && e.message.includes('test message from console')
      );
      expect(found).toBeDefined();
      expect(found?.level).toBe('info');
    });
  });

  describe('async non-blocking writes', () => {
    it('does not block the event loop during rapid writes', async () => {
      // Previously appendFileSync blocked for every log line.
      // After the fix, write() should return synchronously and batch
      // writes asynchronously without blocking the event loop.

      const start = Date.now();
      // Simulate burst: 100 rapid log writes (like RSS cron with 26 sources)
      for (let i = 0; i < 100; i++) {
        logger.info('Burst', `rapid message ${i}`);
      }
      const elapsed = Date.now() - start;

      // All 100 writes should complete synchronously in well under 100ms.
      // With the old appendFileSync, this would take seconds in WSL2.
      expect(elapsed).toBeLessThan(100);

      // Verify all entries are in the in-memory buffer immediately
      const result = logger.query({ limit: 200 });
      const burstLogs = result.logs.filter((e) => e.module === 'Burst');
      expect(burstLogs.length).toBeGreaterThanOrEqual(100);
    });

    it('persists batch writes to disk asynchronously', async () => {
      logger.info('Async', 'before flush');
      logger.info('Async', 'after flush');

      // Wait for the microtask flush to complete
      await new Promise((r) => setTimeout(r, 100));

      await logger.close();

      const today = new Date().toISOString().split('T')[0];
      const filePath = join(tmpDir, `app-${today}.log`);
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      const asyncLines = lines.filter((l) => {
        try { return JSON.parse(l).module === 'Async'; } catch { return false; }
      });
      expect(asyncLines).toHaveLength(2);
    });

    it('uses a debounced mutex instead of an unbounded promise chain', async () => {
      const burstLogger = new Logger(tmpDir);

      // Before any writes, flags should be reset
      expect((burstLogger as any).flushInProgress).toBe(false);
      expect((burstLogger as any).flushRequested).toBe(false);

      // First write spawns the flush microtask
      burstLogger.info('Mutex', 'first');
      expect((burstLogger as any).flushInProgress).toBe(true);
      expect((burstLogger as any).flushRequested).toBe(false);

      // Subsequent writes in the same tick only set flushRequested=true
      burstLogger.info('Mutex', 'second');
      expect((burstLogger as any).flushRequested).toBe(true);

      // Wait for async flush to settle
      await new Promise((r) => setTimeout(r, 200));

      // After flush completes, both flags should be reset
      expect((burstLogger as any).flushInProgress).toBe(false);
      expect((burstLogger as any).flushRequested).toBe(false);

      await burstLogger.close();
    });
  });
});
