import { parseFeed, parseOpml } from 'feedsmith';
import type { InboxEntry } from '../types';

function isPrivateIp(hostname: string): boolean {
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    return false;
  }
  if (hostname === '::1' || hostname === '[::1]') return true;
  if (hostname === 'localhost') return true;
  return false;
}

export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return !isPrivateIp(parsed.hostname);
  } catch {
    return false;
  }
}

export interface OPMLFeed {
  title: string;
  xmlUrl: string;
  htmlUrl: string;
}

export function parseOPML(xml: string): OPMLFeed[] {
  try {
    const opml = parseOpml(xml);
    const outlines = opml.body?.outlines ?? [];
    return outlines
      .filter((o: any) => o.type === 'rss' && o.xmlUrl)
      .map((o: any) => ({
        title: o.title || o.text || 'Untitled',
        xmlUrl: o.xmlUrl,
        htmlUrl: o.htmlUrl || '',
      }));
  } catch {
    return [];
  }
}

export interface RSSItem {
  title: string;
  link: string;
  pubDate?: string;
  description?: string;
  content?: string;
}

function extractText(val: any): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'value' in val) return val.value;
  if (val && typeof val === 'object' && '#text' in val) return val['#text'];
  return String(val ?? '');
}

function getLink(entry: any): string {
  // Atom: links array
  if (entry.links && Array.isArray(entry.links)) {
    const alternate = entry.links.find((l: any) => l.rel === 'alternate' || !l.rel);
    if (alternate?.href) return extractText(alternate.href) || '';
  }
  // RSS: direct link
  return extractText(entry.link) || '';
}

export async function fetchRSS(url: string): Promise<RSSItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentKB/1.0)' },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch RSS ${url}: ${res.status}`);
  }

  const xml = await res.text();
  const { format, feed } = parseFeed(xml);

  if (format === 'rss') {
    const items = feed.items ?? [];
    return items.map((item: any) => ({
      title: extractText(item.title) || 'Untitled',
      link: extractText(item.link) || '',
      pubDate: item.pubDate,
      description: extractText(item.description),
      content: extractText(item.content),
    }));
  }

  if (format === 'atom') {
    const entries = feed.entries ?? [];
    return entries.map((entry: any) => ({
      title: extractText(entry.title) || 'Untitled',
      link: getLink(entry),
      pubDate: entry.published || entry.updated,
      description: extractText(entry.summary),
      content: extractText(entry.content),
    }));
  }

  if (format === 'json') {
    const items = feed.items ?? [];
    return items.map((item: any) => ({
      title: item.title || 'Untitled',
      link: item.url || item.external_url || '',
      pubDate: item.date_published || item.date_modified,
      description: item.summary || '',
      content: item.content_html || item.content_text || '',
    }));
  }

  // RDF or unknown
  const items = feed.items ?? [];
  return items.map((item: any) => ({
    title: extractText(item.title) || 'Untitled',
    link: extractText(item.link) || '',
    pubDate: item.date,
    description: extractText(item.description),
    content: extractText(item.content),
  }));
}

function parsePubDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/** Sort RSS items by pubDate descending (newest first). Items without pubDate go to the end. */
export function sortRSSItems(items: RSSItem[]): RSSItem[] {
  return [...items].sort((a, b) => {
    const da = parsePubDate(a.pubDate);
    const db = parsePubDate(b.pubDate);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.getTime() - da.getTime();
  });
}

export function rssItemToInbox(item: RSSItem, sourceName: string): InboxEntry {
  return {
    sourceType: 'web',
    title: item.title,
    content: `${extractText(item.description)}\n\n${extractText(item.content)}`.trim(),
    extractedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    rawMetadata: {
      rss_source: sourceName,
      rss_link: item.link,
      rss_pubDate: item.pubDate,
    },
  };
}
