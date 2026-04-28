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

  afterEach(() => {
    logger.close();
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
    it('writes logs to daily file', () => {
      logger.info('File', 'persisted');
      logger.close();

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
});
