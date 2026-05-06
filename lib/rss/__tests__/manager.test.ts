import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, it, expect, vi, afterAll } from 'vitest';

vi.mock('../../ingestion/rss', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ingestion/rss')>();
  return {
    ...actual,
    fetchRSS: vi.fn(),
    parseOPML: vi.fn(),
  };
});

vi.mock('../../storage', () => ({
  FileSystemStorage: vi.fn().mockImplementation(function () {
    return {
      writeInbox: vi.fn().mockResolvedValue('1234567890-test.md'),
      listInbox: vi.fn().mockResolvedValue([]),
      listNoteSources: vi.fn().mockResolvedValue([]),
    };
  }),
}));

const testDirs: string[] = [];

function createTestDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rss-mgr-'));
  testDirs.push(dir);
  mkdirSync(join(dir, 'meta'), { recursive: true });
  return dir;
}

async function loadManager(dir: string) {
  vi.resetModules();
  process.env.KNOWLEDGE_ROOT = dir;
  return await import('../manager');
}

let urlCounter = 0;
function uniqueUrl(path = 'feed.xml'): string {
  return `https://test-${urlCounter++}.com/${path}`;
}

function makeItem(overrides: any = {}) {
  return {
    title: 'Article',
    link: 'https://example.com/article',
    pubDate: '2024-06-01T00:00:00Z',
    description: 'Desc',
    content: 'Content',
    ...overrides,
  };
}

afterAll(() => {
  for (const dir of testDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('RSS Manager', () => {
  it('listSubscriptions returns empty array', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    const sources = await manager.listSubscriptions();
    expect(sources).toEqual([]);
  });

  it('adds and lists subscriptions', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    await manager.addSubscription('https://a.com/feed.xml', 'A');
    const sources = await manager.listSubscriptions();
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe('https://a.com/feed.xml');
  });

  it('throws on duplicate subscription', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    const url = uniqueUrl();
    await manager.addSubscription(url, 'X');
    await expect(manager.addSubscription(url, 'Y')).rejects.toThrow('already exists');
  });

  it('removes subscription', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    const url = uniqueUrl();
    await manager.addSubscription(url, 'X');
    await manager.removeSubscription(url);
    const sources = await manager.listSubscriptions();
    expect(sources).toHaveLength(0);
  });

  it('fetches and processes feed items', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    const { fetchRSS } = await import('../../ingestion/rss');
    (fetchRSS as any).mockResolvedValue([makeItem({ link: 'https://example.com/1' })]);

    const url = uniqueUrl();
    await manager.addSubscription(url, 'Feed');
    const result = await manager.checkFeed(url);
    expect(result.newItems).toBe(1);
  });

  it('limits to 5 items on first check', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    const { fetchRSS } = await import('../../ingestion/rss');
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ pubDate: `2024-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`, link: `https://example.com/${i}` })
    );
    (fetchRSS as any).mockResolvedValue(items);

    const url = uniqueUrl();
    await manager.addSubscription(url, 'Feed');
    const result = await manager.checkFeed(url);
    expect(result.newItems).toBe(5);
  });

  it('skips older items on subsequent checks', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    const { fetchRSS } = await import('../../ingestion/rss');
    const url = uniqueUrl();

    (fetchRSS as any).mockResolvedValue([
      makeItem({ pubDate: '2024-06-15T00:00:00Z', link: 'https://example.com/new' }),
    ]);
    await manager.addSubscription(url, 'Feed');
    const first = await manager.checkFeed(url);
    expect(first.newItems).toBe(1);

    (fetchRSS as any).mockResolvedValue([
      makeItem({ pubDate: '2024-01-01T00:00:00Z', link: 'https://example.com/old' }),
    ]);
    const second = await manager.checkFeed(url);
    expect(second.newItems).toBe(0);
  });

  it('deduplicates by rss_link within same batch', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    const { fetchRSS } = await import('../../ingestion/rss');
    (fetchRSS as any).mockResolvedValue([
      makeItem({ link: 'https://example.com/same', pubDate: '2024-06-01T00:00:00Z' }),
      makeItem({ link: 'https://example.com/same', pubDate: '2024-06-02T00:00:00Z' }),
    ]);

    const url = uniqueUrl();
    await manager.addSubscription(url, 'Feed');
    const result = await manager.checkFeed(url);
    expect(result.newItems).toBe(1);
  });

  it('skips duplicate links already in inbox', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    const { fetchRSS } = await import('../../ingestion/rss');
    const { FileSystemStorage } = await import('../../storage');

    (fetchRSS as any).mockResolvedValue([
      makeItem({ link: 'https://example.com/dup', pubDate: '2024-06-01T00:00:00Z' }),
    ]);

    (FileSystemStorage as any).mockImplementationOnce(function () {
      return {
        writeInbox: vi.fn().mockResolvedValue(null),
        listInbox: vi.fn().mockResolvedValue([
          { rawMetadata: { rss_link: 'https://example.com/dup' } },
        ]),
        listNoteSources: vi.fn().mockResolvedValue([]),
      };
    });

    const url = uniqueUrl();
    await manager.addSubscription(url, 'Feed');
    const result = await manager.checkFeed(url);
    expect(result.newItems).toBe(0);
  });

  it('ingests RSS items with maxItems', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ link: `https://example.com/${i}` })
    );
    const result = await manager.ingestRSSItems(uniqueUrl(), 'Feed', items, 2);
    expect(result).toHaveLength(2);
  });

  it('returns items even when all are skipped', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    const url = uniqueUrl();
    const items = [makeItem({ pubDate: '2024-06-01T00:00:00Z', link: 'https://example.com/1' })];
    await manager.ingestRSSItems(url, 'Feed', items);
    const result = await manager.ingestRSSItems(url, 'Feed', items);
    expect(result).toHaveLength(1);
  });

  it('checks all feeds', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    const { fetchRSS } = await import('../../ingestion/rss');
    (fetchRSS as any).mockResolvedValue([]);

    await manager.addSubscription(uniqueUrl(), 'A');
    await manager.addSubscription(uniqueUrl(), 'B');
    const results = await manager.checkAllFeeds();
    expect(results).toHaveLength(2);
  });

  it('importOPML returns error for invalid XML', async () => {
    const dir = createTestDir();
    const manager = await loadManager(dir);
    const { parseOPML } = await import('../../ingestion/rss');
    (parseOPML as any).mockImplementation(() => {
      throw new Error('Invalid OPML: unable to parse XML');
    });
    const result = await manager.importOPML('<not-opml>');
    expect(result.added).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Invalid OPML');
  });
});
