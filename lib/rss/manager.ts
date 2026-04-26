import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import yaml from 'js-yaml';
import { fetchRSS, parseOPML, type RSSItem } from '../ingestion/rss';
import { FileSystemStorage } from '../storage';

export interface RSSSubscription {
  url: string;
  name: string;
  addedAt: string;
  lastChecked?: string;
  lastEntryCount?: number;
}

interface SeenEntries {
  [feedUrl: string]: string[]; // list of seen guids or links
}

const META_DIR = join(process.cwd(), 'knowledge', 'meta');
const SOURCES_PATH = join(META_DIR, 'rss-sources.yml');
const SEEN_PATH = join(META_DIR, 'rss-seen.yml');

async function ensureMetaDir() {
  await mkdir(META_DIR, { recursive: true });
}

async function loadSources(): Promise<RSSSubscription[]> {
  try {
    const raw = await readFile(SOURCES_PATH, 'utf-8');
    return (yaml.load(raw) as RSSSubscription[]) || [];
  } catch {
    return [];
  }
}

async function saveSources(sources: RSSSubscription[]) {
  await ensureMetaDir();
  await writeFile(SOURCES_PATH, yaml.dump(sources, { allowUnicode: true } as any), 'utf-8');
}

async function loadSeen(): Promise<SeenEntries> {
  try {
    const raw = await readFile(SEEN_PATH, 'utf-8');
    return (yaml.load(raw) as SeenEntries) || {};
  } catch {
    return {};
  }
}

async function saveSeen(seen: SeenEntries) {
  await ensureMetaDir();
  await writeFile(SEEN_PATH, yaml.dump(seen, { allowUnicode: true } as any), 'utf-8');
}

function getItemId(item: RSSItem): string {
  // Use link as fallback; some feeds have guid but feedsmith normalizes it
  return item.link || item.title || '';
}

function isSeen(seen: SeenEntries, feedUrl: string, item: RSSItem): boolean {
  const entries = seen[feedUrl] || [];
  const id = getItemId(item);
  return entries.includes(id);
}

function markSeen(seen: SeenEntries, feedUrl: string, item: RSSItem): void {
  if (!seen[feedUrl]) seen[feedUrl] = [];
  const id = getItemId(item);
  if (!seen[feedUrl].includes(id)) {
    seen[feedUrl].push(id);
  }
  // Keep last 500 per feed to prevent unbounded growth
  if (seen[feedUrl].length > 500) {
    seen[feedUrl] = seen[feedUrl].slice(-500);
  }
}

// Prevent concurrent ingest for the same feed URL
const processingFeeds = new Set<string>();

/** Ingest RSS items into inbox with dedup via seen file. */
export async function ingestFeedItems(
  url: string,
  name: string,
  items: RSSItem[],
  maxItems?: number
): Promise<{ title: string; link: string; skipped: boolean }[]> {
  if (processingFeeds.has(url)) {
    console.log(`[RSS] Skip concurrent ingest for ${url}`);
    return [];
  }
  processingFeeds.add(url);

  try {
    let seen = await loadSeen();
    const storage = new FileSystemStorage();
    const results: { title: string; link: string; skipped: boolean }[] = [];

    for (const item of items.slice(0, maxItems ?? items.length)) {
      const alreadySeen = isSeen(seen, url, item);
      results.push({ title: item.title, link: item.link, skipped: alreadySeen });
      if (alreadySeen) continue;

      await storage.writeInbox({
        sourceType: 'web',
        title: item.title,
        content: `${item.description || ''}\n\n${item.content || ''}`.trim(),
        extractedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        rawMetadata: {
          rss_source: name || url,
          rss_link: item.link,
          rss_pubDate: item.pubDate,
        },
      });

      markSeen(seen, url, item);
    }

    await saveSeen(seen);
    return results;
  } finally {
    processingFeeds.delete(url);
  }
}

// ===== Public API =====

export async function listSubscriptions(): Promise<RSSSubscription[]> {
  return loadSources();
}

export async function addSubscription(url: string, name?: string): Promise<RSSSubscription> {
  const sources = await loadSources();
  if (sources.some(s => s.url === url)) {
    throw new Error('Subscription already exists');
  }
  const subscription: RSSSubscription = {
    url,
    name: name || url,
    addedAt: new Date().toISOString(),
  };
  sources.push(subscription);
  await saveSources(sources);
  return subscription;
}

export async function removeSubscription(url: string): Promise<void> {
  const sources = await loadSources();
  const filtered = sources.filter(s => s.url !== url);
  if (filtered.length === sources.length) {
    throw new Error('Subscription not found');
  }
  await saveSources(filtered);
  // Also clean up seen entries
  const seen = await loadSeen();
  delete seen[url];
  await saveSeen(seen);
}

export async function importOPML(xml: string): Promise<{ added: number; errors: string[] }> {
  const feeds = parseOPML(xml);
  const errors: string[] = [];
  let added = 0;
  for (const feed of feeds) {
    try {
      await addSubscription(feed.xmlUrl, feed.title);
      added++;
    } catch (err: any) {
      if (err.message === 'Subscription already exists') {
        // Skip silently
      } else {
        errors.push(`${feed.title}: ${err.message}`);
      }
    }
  }
  return { added, errors };
}

export interface CheckResult {
  url: string;
  name: string;
  newItems: number;
  error?: string;
}

export async function checkFeed(url: string): Promise<CheckResult> {
  const sources = await loadSources();
  const source = sources.find(s => s.url === url);
  const name = source?.name || url;

  try {
    const items = await fetchRSS(url);
    const results = await ingestFeedItems(url, name, items);
    const newItems = results.filter((r) => !r.skipped).length;

    // Update source metadata
    if (source) {
      source.lastChecked = new Date().toISOString();
      source.lastEntryCount = items.length;
      await saveSources(sources);
    }

    return { url, name, newItems };
  } catch (err: any) {
    return { url, name, newItems: 0, error: err.message };
  }
}

export async function checkAllFeeds(): Promise<CheckResult[]> {
  const sources = await loadSources();
  const results: CheckResult[] = [];
  for (const source of sources) {
    const result = await checkFeed(source.url);
    results.push(result);
    // Small delay between feeds to be polite
    await new Promise(r => setTimeout(r, 500));
  }
  return results;
}
