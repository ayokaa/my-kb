import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpDir = mkdtempSync(join(tmpdir(), 'kb-queue-test-'));
process.env.KNOWLEDGE_ROOT = tmpDir;

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import yaml from 'js-yaml';
import { writeFile, rename } from 'fs/promises';
import { parseInboxEntry } from '../parsers';
import { enqueue, getTask, listPending, listTasks, retryTask, initQueue } from '../queue';

vi.mock('fs/promises', () => {
  const mocks = {
    readFile: vi.fn().mockRejectedValue(new Error('no file')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockRejectedValue(new Error('no file')),
  };
  return {
    ...mocks,
    default: mocks,
  } as any;
});

vi.mock('@/lib/cognition/ingest', () => ({
  processInboxEntry: vi.fn().mockResolvedValue({
    note: {
      id: 'test-note',
      title: 'Test',
      tags: [],
      status: 'seed',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      sources: [],
      summary: '',
      personalContext: '',
      keyFacts: [],
      timeline: [],
      links: [],
      qas: [],
      content: '',
    },
  }),
}));

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function () {
    return {
      listNotes: vi.fn().mockResolvedValue([]),
      listNoteSources: vi.fn().mockResolvedValue([]),
      saveNote: vi.fn().mockResolvedValue(undefined),
      archiveInbox: vi.fn().mockResolvedValue(undefined),
      writeInbox: vi.fn().mockResolvedValue(undefined),
      listInbox: vi.fn().mockResolvedValue([]),
    };
  }),
}));

function makeInboxMd(title: string, extra: Record<string, string> = {}) {
  const fm = { source_type: 'text', title, extracted_at: '2025-01-01T00:00:00Z', ...extra };
  return `---\n${yaml.dump(fm)}---\n\nContent for ${title}`;
}

/* ===== parseInboxEntry (pure, no mocks) ===== */

describe('parseInboxEntry', () => {
  it('parses YAML frontmatter into InboxEntry', () => {
    const raw = makeInboxMd('Hello World', { rss_link: 'https://example.com' });
    const entry = parseInboxEntry(raw, '/path/to/123-hello.md');

    expect(entry.sourceType).toBe('text');
    expect(entry.title).toBe('Hello World');
    expect(entry.content).toBe('Content for Hello World');
    expect(entry.rawMetadata.rss_link).toBe('https://example.com');
    expect(entry.filePath).toBe('/path/to/123-hello.md');
  });

  it('handles raw content without frontmatter', () => {
    const raw = 'Just some plain text without frontmatter';
    const entry = parseInboxEntry(raw, '/path/to/plain.md');

    expect(entry.sourceType).toBe('text');
    expect(entry.title).toBe('plain');
    expect(entry.content).toBe(raw);
    expect(entry.rawMetadata).toEqual({});
  });

  it('extracts rss_link and source_url into rawMetadata', () => {
    const raw = makeInboxMd('RSS', { rss_link: 'https://a.com', source_url: 'https://b.com' });
    const entry = parseInboxEntry(raw, '/path/to/rss.md');
    expect(entry.rawMetadata.rss_link).toBe('https://a.com');
    expect(entry.rawMetadata.source_url).toBe('https://b.com');
  });
});

/* ===== enqueue / getTask / listPending ===== */

describe('enqueue / getTask / listPending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Poll until a task reaches the expected status or timeout. */
  async function waitForStatus(
    taskId: string,
    status: 'pending' | 'running' | 'done' | 'failed',
    timeout = 5000,
    interval = 50
  ) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const task = getTask(taskId);
      if (task?.status === status) return task;
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Timeout waiting for ${taskId} to reach ${status}`);
  }

  it('enqueue returns a task id', () => {
    const id = enqueue('ingest', { fileName: 'test.md' });
    expect(typeof id).toBe('string');
    expect(id.startsWith('task-')).toBe(true);
  });

  it('getTask retrieves the created task', () => {
    const id = enqueue('ingest', { fileName: 'test.md' });
    const task = getTask(id);
    expect(task).toBeDefined();
    expect(task!.type).toBe('ingest');
    expect((task!.payload as any).fileName).toBe('test.md');
  });

  it('listPending returns pending tasks', () => {
    const before = listPending().length;
    enqueue('ingest', { fileName: 'pending.md' });
    const after = listPending().length;
    expect(after).toBe(before + 1);
  });

  it('persists queue state to disk after enqueue', async () => {
    enqueue('ingest', { fileName: 'persist.md' });
    // Poll until writeFile mock is called (saveQueueState completes)
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if ((writeFile as any).mock?.calls?.length > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(writeFile).toHaveBeenCalled();
  });

  it('retryTask resets failed task and re-queues it', async () => {
    const id = enqueue('ingest', { fileName: 'fail.md' });
    // Wait for worker to process and fail (readFile mock rejects)
    await waitForStatus(id, 'failed');

    const failed = getTask(id);
    expect(failed!.status).toBe('failed');
    expect(failed!.error).toBeDefined();

    const retried = retryTask(id);
    expect(retried).toBeDefined();
    expect(retried!.id).toBe(id);
    expect(retried!.error).toBeUndefined();
    expect(retried!.result).toBeUndefined();
    expect(retried!.completedAt).toBeUndefined();

    // Worker picks it up asynchronously; wait for it to fail again
    await waitForStatus(id, 'failed');
    const final = getTask(id);
    expect(final!.status).toBe('failed');
  });

  it('retryTask returns null for non-existent task', () => {
    expect(retryTask('non-existent')).toBeNull();
  });

  it('retryTask preserves taskCache across retries', () => {
    const id = enqueue('ingest', { fileName: 'cache-test.md' });
    const task = getTask(id)!;
    task.taskCache = { webContent: { title: 'Cached Title', content: 'Cached body text' } };

    // Force task to failed so we can retry
    task.status = 'failed';
    task.error = 'Simulated LLM error';
    task.completedAt = new Date().toISOString();

    const retried = retryTask(id);
    expect(retried!.taskCache).toEqual({ webContent: { title: 'Cached Title', content: 'Cached body text' } });
    expect(retried!.error).toBeUndefined();
    expect(retried!.result).toBeUndefined();
  });

  it('newly enqueued tasks have no taskCache', () => {
    const id = enqueue('ingest', { fileName: 'fresh.md' });
    const task = getTask(id)!;
    expect(task.taskCache).toBeUndefined();
  });

  it('retryTask returns null for non-failed task', () => {
    const freshId = enqueue('ingest', { fileName: 'fresh.md' });
    expect(retryTask(freshId)).toBeNull();
  });

  it('skips duplicate source during ingest', async () => {
    const { readFile, stat } = await import('fs/promises');
    const prevReadFile = (readFile as any).getMockImplementation();
    const prevStat = (stat as any).getMockImplementation();
    (readFile as any).mockImplementation(async (path: string) => {
      if (typeof path === 'string' && path.includes('dup.md')) {
        return makeInboxMd('RSS Article', { rss_link: 'https://example.com/feed' });
      }
      throw new Error('no file');
    });
    (stat as any).mockResolvedValue({} as any);

    const { FileSystemStorage } = await import('@/lib/storage');
    const prevImpl = (FileSystemStorage as any).getMockImplementation();
    (FileSystemStorage as any).mockImplementation(function () {
      return {
        listNoteSources: vi.fn().mockResolvedValue([{ id: 'existing', sources: ['https://example.com/feed'] }]),
        archiveInbox: vi.fn().mockResolvedValue(undefined),
        saveNote: vi.fn().mockResolvedValue(undefined),
      };
    });

    const id = enqueue('ingest', { fileName: 'dup.md' });
    try {
      await waitForStatus(id, 'done', 3000);
    } catch {
      const task = getTask(id);
      throw new Error(`Task did not reach done: status=${task?.status} error=${task?.error}`);
    } finally {
      (readFile as any).mockImplementation(prevReadFile as any);
      (stat as any).mockImplementation(prevStat as any);
      (FileSystemStorage as any).mockImplementation(prevImpl as any);
    }

    const task = getTask(id);
    expect(task?.result).toEqual({ skipped: true, reason: 'duplicate source' });
  });

  it('skips web_fetch when URL already exists in note sources', async () => {
    const { FileSystemStorage } = await import('@/lib/storage');
    const prevImpl = (FileSystemStorage as any).getMockImplementation();
    (FileSystemStorage as any).mockImplementation(function () {
      return {
        listNoteSources: vi.fn().mockResolvedValue([{ id: 'existing', sources: ['https://example.com/article'] }]),
        listNotes: vi.fn().mockResolvedValue([]),
        saveNote: vi.fn().mockResolvedValue(undefined),
        rebuildBacklinks: vi.fn().mockResolvedValue(undefined),
      };
    });

    const id = enqueue('web_fetch', { url: 'https://example.com/article' });
    try {
      await waitForStatus(id, 'done', 3000);
    } catch {
      const task = getTask(id);
      throw new Error(`Task did not reach done: status=${task?.status} error=${task?.error}`);
    } finally {
      (FileSystemStorage as any).mockImplementation(prevImpl as any);
    }

    const task = getTask(id);
    expect(task?.status).toBe('done');
    expect(task?.result).toEqual({ skipped: true, reason: 'duplicate source', url: 'https://example.com/article' });
  });

  it('marks task failed when inbox file is missing (stat rejects)', async () => {
    const id = enqueue('ingest', { fileName: 'missing.md' });
    await waitForStatus(id, 'failed');
    const task = getTask(id);
    expect(task!.status).toBe('failed');
    expect(task!.error).toContain('Inbox file not found');
  });

  it('saveQueueState handles rapid concurrent enqueues without data loss', async () => {
    const before = listTasks().length;
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(enqueue('ingest', { fileName: `concurrent-${i}.md` }));
    }
    // Poll until all saveQueueState calls settle (writeFile mock calls stabilize)
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const currentCalls = (writeFile as any).mock?.calls?.length || 0;
      await new Promise((r) => setTimeout(r, 50));
      const newCalls = (writeFile as any).mock?.calls?.length || 0;
      if (newCalls === currentCalls) break;
    }

    const allTasks = listTasks();
    expect(allTasks.length).toBeGreaterThanOrEqual(before + 10);
    for (const id of ids) {
      expect(getTask(id)).toBeDefined();
    }
  });

  /**
   * Reproduction test for the unbounded promise chain issue in saveQueueState.
   *
   * The RSS cron fires at 0 * * * * and calls enqueue() for every subscription
   * (26 in production). Each enqueue() triggers saveQueueState() which previously
   * used saveLock = saveLock.then(...).catch(...) — an unbounded chain pattern.
   *
   * In WSL2 with slow 9p filesystem, 26 sequential atomicWrite (writeFile + rename)
   * operations accumulated and contributed to event loop blocking.
   *
   * This test verifies that rapid enqueue() calls DO NOT trigger an equal number
   * of file writes — they should be batched/debounced.
   */
  it('debounces saveQueueState: rapid enqueues should batch file writes', async () => {
    // Reset the writeFile mock counter
    (writeFile as any).mockClear();

    // Simulate RSS cron: enqueue 26 tasks rapidly (matching production subscription count)
    const N = 26;
    for (let i = 0; i < N; i++) {
      enqueue('rss_fetch', {
        url: `https://example.com/feed-${i}.xml`,
        name: `Feed ${i}`,
        isSubscriptionCheck: true,
      });
    }

    // Wait for async save operations to settle
    await new Promise((r) => setTimeout(r, 500));

    const writeCount = (writeFile as any).mock?.calls?.length || 0;
    const renameCount = (rename as any).mock?.calls?.length || 0;

    // After the fix: 26 rapid enqueues should batch into far fewer than 26 writes.
    // Without the fix, this would be ~26+ writeFile calls (one per enqueue).
    expect(writeCount).toBeLessThan(N);
    // Allow a few extra writes from worker state updates (task start/complete),
    // but the total should still be a small fraction of the enqueue count.
    expect(writeCount).toBeLessThanOrEqual(6);

    // Verify all tasks exist (some may have been processed by now; all should be findable)
    const all = listTasks(500);
    const rssTasks = all.filter(t => t.type === 'rss_fetch');
    const rssTaskIds = new Set(rssTasks.map(t => t.id));
    for (let i = 0; i < N; i++) {
      // At least the tasks should be retrievable by getTask
      const found = rssTasks.find(t =>
        (t.payload as any).url === `https://example.com/feed-${i}.xml`
      );
      expect(found, `RSS task ${i} should exist`).toBeDefined();
    }
  });

  it('listTasks respects limit parameter', async () => {
    const before = listTasks().length;
    for (let i = 0; i < 5; i++) {
      enqueue('ingest', { fileName: `limit-${i}.md` });
    }
    const all = listTasks(100);
    expect(all.length).toBeGreaterThanOrEqual(before + 5);
    const limited = listTasks(2);
    expect(limited.length).toBeLessThanOrEqual(2);
  });

  it('processes rss_fetch task via subscription check', async () => {
    const { fetchRSS } = await import('@/lib/ingestion/rss');
    const fetchRSSMock = vi.fn().mockResolvedValue([
      { title: 'RSS Item', link: 'https://example.com/item', pubDate: '2024-01-01T00:00:00Z' },
    ]);
    vi.doMock('@/lib/ingestion/rss', () => ({ fetchRSS: fetchRSSMock }));

    // Stub global fetch for manager.ts
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    }));

    const id = enqueue('rss_fetch', {
      url: 'https://example.com/feed.xml',
      name: 'Test Feed',
      isSubscriptionCheck: true,
    });
    await waitForStatus(id, 'done');
    const task = getTask(id);
    expect(task!.status).toBe('done');
    expect(task!.result).toBeDefined();

    vi.unstubAllGlobals();
  });
});

describe('parseInboxEntry — edge cases', () => {
  it('handles frontmatter without closing marker', () => {
    const raw = '---\nsource_type: text\ntitle: No Close';
    const entry = parseInboxEntry(raw, '/path/to/no-close.md');
    expect(entry.sourceType).toBe('text');
    expect(entry.title).toBe('no-close');
    expect(entry.content).toBe(raw);
  });

  it('preserves unknown frontmatter fields in rawMetadata', () => {
    const raw = `---\nsource_type: web\ntitle: Custom\ncustom_field: hello\n---\n\nBody here`;
    const entry = parseInboxEntry(raw, '/path/to/custom.md');
    expect(entry.rawMetadata.custom_field).toBe('hello');
    expect(entry.content).toBe('Body here');
  });

  it('initQueue is safe to call multiple times', () => {
    // Should not throw or start multiple workers
    initQueue();
    initQueue();
    initQueue();
    expect(true).toBe(true);
  });
});
