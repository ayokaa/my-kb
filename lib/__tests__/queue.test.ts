import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpDir = mkdtempSync(join(tmpdir(), 'kb-queue-test-'));
process.env.KNOWLEDGE_ROOT = tmpDir;

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import yaml from 'js-yaml';
import { writeFile } from 'fs/promises';
import { parseInboxRaw, enqueue, getTask, listPending, retryTask } from '../queue';

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
  processInboxEntry: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function () {
    return {
      listNotes: vi.fn().mockResolvedValue([]),
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

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 150));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

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
    expect(['pending', 'running', 'done', 'failed']).toContain(task!.status);
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
    await new Promise((r) => setTimeout(r, 100));
    expect(writeFile).toHaveBeenCalled();
  });

  it('retryTask resets failed task and re-queues it', async () => {
    const id = enqueue('ingest', { fileName: 'fail.md' });
    // Wait for worker to process and fail (readFile mock rejects)
    await new Promise((r) => setTimeout(r, 200));

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
    await new Promise((r) => setTimeout(r, 200));
    const final = getTask(id);
    expect(final!.status).toBe('failed');
  });

  it('retryTask returns null for non-existent task', () => {
    expect(retryTask('non-existent')).toBeNull();
  });

  it('retryTask returns null for non-failed task', () => {
    const id = enqueue('ingest', { fileName: 'new.md' });
    expect(retryTask(id)).toBeNull();
  });
});
