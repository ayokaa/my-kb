import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';

const { mockProcessInboxEntry, mockListNotes, mockSaveNote } = vi.hoisted(() => ({
  mockProcessInboxEntry: vi.fn().mockResolvedValue({
    note: { id: 'note-1', title: 'Test', status: 'seed', tags: [], sources: [], content: '' },
  }),
  mockListNotes: vi.fn().mockResolvedValue([]),
  mockSaveNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/cognition/ingest', () => ({
  processInboxEntry: mockProcessInboxEntry,
}));

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function () {
    return { listNotes: mockListNotes, saveNote: mockSaveNote };
  }),
}));

const { parseInboxRaw, runIngestTask } = await import('../queue');

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

/* ===== runIngestTask (direct call, real fs for file reads) ===== */

describe('runIngestTask', () => {
  let tmpDir: string;
  let archiveDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'queue-test-'));
    archiveDir = join(tmpDir, 'archive', 'inbox');
    mkdirSync(archiveDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads file from archive directory and creates note', async () => {
    writeFileSync(join(archiveDir, 'test.md'), makeInboxMd('Test'));

    await runIngestTask({ fileName: 'test.md' }, archiveDir);

    expect(mockProcessInboxEntry).toHaveBeenCalledTimes(1);
    expect(mockSaveNote).toHaveBeenCalledTimes(1);
  });

  it('throws when file is missing', async () => {
    await expect(runIngestTask({ fileName: 'missing.md' }, archiveDir))
      .rejects.toThrow(/ENOENT/);
  });

  it('skips and returns { skipped: true } for duplicate source URL', async () => {
    mockListNotes.mockResolvedValue([{ sources: ['https://example.com/art'] }]);
    writeFileSync(join(archiveDir, 'dupe.md'), makeInboxMd('Dupe', { rss_link: 'https://example.com/art' }));

    const result = await runIngestTask({ fileName: 'dupe.md' }, archiveDir);

    expect(result).toEqual({ skipped: true, reason: 'duplicate source' });
    expect(mockProcessInboxEntry).not.toHaveBeenCalled();
    expect(mockSaveNote).not.toHaveBeenCalled();
  });

  it('processes entry without URL (no dedup check)', async () => {
    writeFileSync(join(archiveDir, 'plain.md'), makeInboxMd('Plain'));

    await runIngestTask({ fileName: 'plain.md' }, archiveDir);

    expect(mockProcessInboxEntry).toHaveBeenCalledTimes(1);
    expect(mockSaveNote).toHaveBeenCalledTimes(1);
    expect(mockListNotes).not.toHaveBeenCalled();
  });
});
