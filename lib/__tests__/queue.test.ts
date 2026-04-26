import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpDir = mkdtempSync(join(tmpdir(), 'kb-queue-test-'));
process.env.KNOWLEDGE_ROOT = tmpDir;

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import yaml from 'js-yaml';
import { writeFile } from 'fs/promises';
import { parseInboxRaw, enqueue, getTask, listPending, listTasks, retryTask } from '../queue';

vi.mock('fs/promises', () => {
  const mocks = {
    readFile: vi.fn().mockRejectedValue(new Error('no file')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
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
    };
  }),
}));

function makeInboxMd(title: string, extra: Record<string, string> = {}) {
  const fm = { source_type: 'text', title, extracted_at: '2025-01-01T00:00:00Z', ...extra };
  return `---\n${yaml.dump(fm)}---\n\nContent for ${title}`;
}

/* ===== parseInboxRaw (pure, no mocks) ===== */

describe('parseInboxRaw', () => {
  it('parses YAML frontmatter into InboxEntry', () => {
    const raw = makeInboxMd('Hello World', { rss_link: 'https://example.com' });
    const entry = parseInboxRaw(raw, '/path/to/123-hello.md');

    expect(entry.sourceType).toBe('text');
    expect(entry.title).toBe('Hello World');
    expect(entry.content).toBe('Content for Hello World');
    expect(entry.rawMetadata.rss_link).toBe('https://example.com');
    expect(entry.filePath).toBe('/path/to/123-hello.md');
  });

  it('handles raw content without frontmatter', () => {
    const raw = 'Just some plain text without frontmatter';
    const entry = parseInboxRaw(raw, '/path/to/plain.md');

    expect(entry.sourceType).toBe('text');
    expect(entry.title).toBe('plain');
    expect(entry.content).toBe(raw);
    expect(entry.rawMetadata).toEqual({});
  });

  it('extracts rss_link and source_url into rawMetadata', () => {
    const raw = makeInboxMd('RSS', { rss_link: 'https://a.com', source_url: 'https://b.com' });
    const entry = parseInboxRaw(raw, '/path/to/rss.md');
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
    expect(task!.payload.fileName).toBe('test.md');
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

  it('retryTask returns null for non-failed task', () => {
    const freshId = enqueue('ingest', { fileName: 'fresh.md' });
    expect(retryTask(freshId)).toBeNull();
  });

  it('skips duplicate source during ingest', async () => {
    const { readFile } = await import('fs/promises');
    const prevReadFile = readFile.getMockImplementation();
    readFile.mockImplementation(async (path: string) => {
      if (typeof path === 'string' && path.includes('dup.md')) {
        return makeInboxMd('RSS Article', { rss_link: 'https://example.com/feed' });
      }
      throw new Error('no file');
    });

    const { FileSystemStorage } = await import('@/lib/storage');
    const prevImpl = FileSystemStorage.getMockImplementation();
    FileSystemStorage.mockImplementation(function () {
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
      readFile.mockImplementation(prevReadFile as any);
      FileSystemStorage.mockImplementation(prevImpl as any);
    }

    const task = getTask(id);
    expect(task?.result).toEqual({ skipped: true, reason: 'duplicate source' });
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
});
