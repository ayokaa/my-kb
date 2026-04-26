import { describe, it, expect, vi } from 'vitest';
import yaml from 'js-yaml';
import { parseInboxRaw, enqueue, getTask, listPending } from '../queue';

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
    expect(task!.status).toBe('pending');
    expect(task!.payload.fileName).toBe('test.md');
  });

  it('listPending returns pending tasks', () => {
    const before = listPending().length;
    enqueue('ingest', { fileName: 'pending.md' });
    const after = listPending().length;
    expect(after).toBe(before + 1);
  });
});
