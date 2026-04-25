import { XMLParser } from 'fast-xml-parser';
import type { InboxEntry } from '../types';

export interface RSSItem {
  title: string;
  link: string;
  pubDate?: string;
  description?: string;
  content?: string;
}

export async function fetchRSS(url: string): Promise<RSSItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentKB/1.0)' },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch RSS ${url}: ${res.status}`);
  }

  const xml = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  const data = parser.parse(xml);

  // RSS 2.0
  const channel = data.rss?.channel;
  if (channel?.item) {
    const items = Array.isArray(channel.item) ? channel.item : [channel.item];
    return items.map((item: any) => ({
      title: item.title || 'Untitled',
      link: item.link || '',
      pubDate: item.pubDate,
      description: item.description,
      content: item['content:encoded'] || item.description,
    }));
  }

  // Atom
  const feed = data.feed;
  if (feed?.entry) {
    const entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry];
    return entries.map((entry: any) => ({
      title: entry.title?.['#text'] || entry.title || 'Untitled',
      link: entry.link?.['@_href'] || entry.link || '',
      pubDate: entry.updated || entry.published,
      description: entry.summary,
      content: entry.content?.['#text'] || entry.summary,
    }));
  }

  return [];
}

export function rssItemToInbox(item: RSSItem, sourceName: string): InboxEntry {
  return {
    sourceType: 'web',
    title: item.title,
    content: `${item.description || ''}\n\n${item.content || ''}`.trim(),
    extractedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    rawMetadata: {
      rss_source: sourceName,
      rss_link: item.link,
      rss_pubDate: item.pubDate,
    },
  };
}
