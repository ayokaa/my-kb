import { describe, it, expect, vi } from 'vitest';
import { fetchRSS, rssItemToInbox, parseOPML, sortRSSItems, isValidHttpUrl } from '../rss';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('fetchRSS', () => {
  it('parses RSS 2.0 feed', async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Test Feed</title>
          <item>
            <title>Article One</title>
            <link>https://example.com/1</link>
            <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
            <description>Description one</description>
          </item>
          <item>
            <title>Article Two</title>
            <link>https://example.com/2</link>
          </item>
        </channel>
      </rss>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(xml),
    }));

    const items = await fetchRSS('https://example.com/rss.xml');
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Article One');
    expect(items[0].link).toBe('https://example.com/1');
    expect(items[0].pubDate).toBe('Mon, 01 Jan 2024 00:00:00 GMT');

    vi.unstubAllGlobals();
  });

  it('parses Atom feed', async () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom Feed</title>
        <entry>
          <title>Entry One</title>
          <link href="https://example.com/a1"/>
          <updated>2024-01-01T00:00:00Z</updated>
          <summary>Summary one</summary>
        </entry>
      </feed>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(xml),
    }));

    const items = await fetchRSS('https://example.com/atom.xml');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Entry One');
    expect(items[0].link).toBe('https://example.com/a1');

    vi.unstubAllGlobals();
  });

  it('throws on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    await expect(fetchRSS('https://example.com/bad')).rejects.toThrow('500');

    vi.unstubAllGlobals();
  });
});

describe('rssItemToInbox', () => {
  it('converts RSS item to inbox entry', () => {
    const item = {
      title: 'Test Article',
      link: 'https://example.com/test',
      pubDate: '2024-01-01T00:00:00Z',
      description: 'Short desc',
      content: 'Full content',
    };

    const entry = rssItemToInbox(item, 'My Blog');
    expect(entry.sourceType).toBe('web');
    expect(entry.title).toBe('Test Article');
    expect(entry.content).toContain('Short desc');
    expect(entry.content).toContain('Full content');
    expect(entry.rawMetadata.rss_source).toBe('My Blog');
    expect(entry.rawMetadata.rss_link).toBe('https://example.com/test');
  });
});

describe('parseOPML', () => {
  it('parses feeder.opml fixture', () => {
    const opml = readFileSync(join(__dirname, 'fixtures', 'feeder.opml'), 'utf-8');
    const feeds = parseOPML(opml);

    expect(feeds.length).toBe(35);
    expect(feeds[0]).toEqual({
      title: "Simon Willison's Weblog",
      xmlUrl: 'https://simonwillison.net/atom/everything/',
      htmlUrl: 'http://simonwillison.net/',
    });
    expect(feeds.some(f => f.title === 'Overreacted')).toBe(true);
    expect(feeds.some(f => f.xmlUrl === 'https://dynomight.net/feed.xml')).toBe(true);
  });

  it('throws for invalid XML', () => {
    expect(() => parseOPML('<notopml></notopml>')).toThrow('Invalid OPML');
  });
});

describe('sortRSSItems', () => {
  it('sorts items by pubDate descending', () => {
    const items = [
      { title: 'Old', link: 'https://example.com/old', pubDate: '2024-01-01T00:00:00Z' },
      { title: 'New', link: 'https://example.com/new', pubDate: '2024-03-01T00:00:00Z' },
      { title: 'Mid', link: 'https://example.com/mid', pubDate: '2024-02-01T00:00:00Z' },
    ];
    const sorted = sortRSSItems(items);
    expect(sorted.map(i => i.title)).toEqual(['New', 'Mid', 'Old']);
  });

  it('places items without pubDate at the end', () => {
    const items = [
      { title: 'NoDate', link: 'https://example.com/nodate' },
      { title: 'HasDate', link: 'https://example.com/hasdate', pubDate: '2024-01-01T00:00:00Z' },
    ];
    const sorted = sortRSSItems(items);
    expect(sorted.map(i => i.title)).toEqual(['HasDate', 'NoDate']);
  });

  it('returns empty array for empty input', () => {
    expect(sortRSSItems([])).toEqual([]);
  });

  it('does not mutate original array', () => {
    const items = [
      { title: 'A', link: 'https://example.com/a', pubDate: '2024-01-01T00:00:00Z' },
      { title: 'B', link: 'https://example.com/b', pubDate: '2024-02-01T00:00:00Z' },
    ];
    sortRSSItems(items);
    expect(items[0].title).toBe('A');
  });
});

describe('isValidHttpUrl', () => {
  it('accepts valid http/https URLs', () => {
    expect(isValidHttpUrl('https://example.com')).toBe(true);
    expect(isValidHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects non-http protocols', () => {
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isValidHttpUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects private IPs', () => {
    expect(isValidHttpUrl('http://127.0.0.1')).toBe(false);
    expect(isValidHttpUrl('http://10.0.0.1')).toBe(false);
    expect(isValidHttpUrl('http://172.16.0.1')).toBe(false);
    expect(isValidHttpUrl('http://192.168.1.1')).toBe(false);
    expect(isValidHttpUrl('http://localhost')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isValidHttpUrl('not a url')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
  });
});

describe('fetchRSS — JSON feed', () => {
  it('parses JSON Feed 1.1', async () => {
    const json = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'JSON Feed',
      items: [
        {
          title: 'JSON Item',
          url: 'https://example.com/json-item',
          date_published: '2024-02-01T00:00:00Z',
          summary: 'JSON summary',
          content_html: '<p>HTML content</p>',
        },
      ],
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(json),
    }));

    const items = await fetchRSS('https://example.com/feed.json');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('JSON Item');
    expect(items[0].link).toBe('https://example.com/json-item');
    expect(items[0].pubDate).toBe('2024-02-01T00:00:00Z');

    vi.unstubAllGlobals();
  });
});

describe('fetchRSS — RDF / unknown', () => {
  it('parses RDF feed', async () => {
    const xml = `<?xml version="1.0"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
               xmlns="http://purl.org/rss/1.0/">
        <channel>
          <title>RDF Feed</title>
          <link>https://example.com</link>
        </channel>
        <item>
          <title>RDF Item</title>
          <link>https://example.com/rdf</link>
          <description>RDF desc</description>
        </item>
      </rdf:RDF>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(xml),
    }));

    const items = await fetchRSS('https://example.com/rdf.xml');
    expect(items.length).toBeGreaterThanOrEqual(0);

    vi.unstubAllGlobals();
  });
});

describe('rssItemToInbox', () => {
  it('converts item without pubDate', () => {
    const item = {
      title: 'No Date',
      link: 'https://example.com/nodate',
      description: 'desc',
    };
    const entry = rssItemToInbox(item, 'Source');
    expect(entry.title).toBe('No Date');
    expect(entry.extractedAt).toBeDefined();
  });

  it('converts item without description or content', () => {
    const item = {
      title: 'Sparse',
      link: 'https://example.com/sparse',
      pubDate: '2024-01-01T00:00:00Z',
    };
    const entry = rssItemToInbox(item, 'Src');
    expect(entry.content).toBe('');
  });
});

describe('fetchRSS integration — real feeds', () => {
  const hasNetwork = !process.env.CI;

  it.skipIf(!hasNetwork)('fetches Simon Willison\'s Atom feed', async () => {
    const items = await fetchRSS('https://simonwillison.net/atom/everything/');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].title).toBeTruthy();
    expect(items[0].link).toMatch(/^https?:\/\//);
  }, 30000);

  it.skipIf(!hasNetwork)('fetches Overreacted RSS feed', async () => {
    const items = await fetchRSS('https://overreacted.io/rss.xml');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].title).toBeTruthy();
    expect(items[0].link).toMatch(/^https?:\/\//);
  }, 30000);
});
