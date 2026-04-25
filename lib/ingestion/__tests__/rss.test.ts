import { describe, it, expect, vi } from 'vitest';
import { fetchRSS, rssItemToInbox, parseOPML } from '../rss';
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

  it('returns empty array for invalid XML', () => {
    expect(parseOPML('<notopml></notopml>')).toEqual([]);
  });
});

describe('fetchRSS integration — real feeds', () => {
  it('fetches Simon Willison\'s Atom feed', async () => {
    const items = await fetchRSS('https://simonwillison.net/atom/everything/');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].title).toBeTruthy();
    expect(items[0].link).toMatch(/^https?:\/\//);
  }, 30000);

  it('fetches Overreacted RSS feed', async () => {
    const items = await fetchRSS('https://overreacted.io/rss.xml');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].title).toBeTruthy();
    expect(items[0].link).toMatch(/^https?:\/\//);
  }, 30000);
});
