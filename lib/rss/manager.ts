import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import yaml from 'js-yaml';
import { fetchRSS, parseOPML, sortRSSItems, type RSSItem, type OPMLFeed } from '../ingestion/rss';
import { FileSystemStorage } from '../storage';
import { logger } from '../logger';
import { enqueue } from '../queue';
import { loadSettings } from '../settings';

export interface RSSSubscription {
  url: string;
  name: string;
  addedAt: string;
  lastChecked?: string;
  lastEntryCount?: number;
  lastPubDate?: string; // latest pubDate processed for this feed
}

const KNOWLEDGE_ROOT = process.env.KNOWLEDGE_ROOT || 'knowledge';
const META_DIR = join(process.cwd(), KNOWLEDGE_ROOT, 'meta');
const SOURCES_PATH = join(META_DIR, 'rss-sources.yml');

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
  await writeFile(SOURCES_PATH, yaml.dump(sources, { allowUnicode: true } as import('@/lib/types').YamlDumpOptions), 'utf-8');
}

// Prevent concurrent ingest for the same feed URL
const processingFeeds = new Set<string>();

function normalizePubDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function isNewerPubDate(itemPubDate: string, lastPubDate: string): boolean {
  const itemDate = new Date(itemPubDate);
  const lastDate = new Date(lastPubDate);
  if (isNaN(itemDate.getTime()) || isNaN(lastDate.getTime())) return true;
  return itemDate.getTime() > lastDate.getTime();
}

/** Write feed items to inbox with lastPubDate filtering.
 *  - If lastPubDate is set: only items with pubDate > lastPubDate are ingested.
 *  - If lastPubDate is absent (first time): ingest up to 5 most-recent items.
 *  Returns the latest pubDate encountered (to update subscription metadata).
 */
async function processFeedItems(
  url: string,
  name: string,
  items: RSSItem[],
  lastPubDate?: string,
  maxItems?: number
): Promise<{ count: number; latestPubDate: string }> {
  if (processingFeeds.has(url)) {
    logger.info('RSS', `Skip concurrent ingest for ${url}`);
    return { count: 0, latestPubDate: normalizePubDate(lastPubDate) };
  }
  processingFeeds.add(url);

  try {
    const storage = new FileSystemStorage();
    let count = 0;
    let latestPubDate = normalizePubDate(lastPubDate);

    // Sort items by pubDate descending to ensure lastPubDate is updated correctly
    const sortedItems = sortRSSItems(items);

    // Pre-check existing inbox + archive links for deduplication
    const existingLinks = new Set<string>();
    try {
      const inboxEntries = await storage.listInbox();
      for (const entry of inboxEntries) {
        const link = entry.rawMetadata?.rss_link as string | undefined;
        if (link) existingLinks.add(link);
      }
    } catch {
      // Ignore list errors
    }

    for (const item of sortedItems) {
      const itemPubDate = item.pubDate || '';
      const normalizedItemDate = normalizePubDate(itemPubDate);

      // Update latestPubDate for all valid pubDates, even if skipped
      if (normalizedItemDate && (!latestPubDate || isNewerPubDate(normalizedItemDate, latestPubDate))) {
        latestPubDate = normalizedItemDate;
      }

      if (maxItems !== undefined && count >= maxItems) break;

      // With lastPubDate: skip items that are not newer (use Date comparison for reliability)
      if (lastPubDate && itemPubDate) {
        if (!isNewerPubDate(itemPubDate, lastPubDate)) {
          continue;
        }
      }

      // Without lastPubDate (first check): ingest at most 5 items
      if (!lastPubDate && count >= 5) break;

      // Deduplication: skip if inbox already has this rss_link
      if (item.link && existingLinks.has(item.link)) {
        logger.info('RSS', `Skip duplicate inbox entry: ${item.title}`);
        continue;
      }

      const writtenFileName = await storage.writeInbox({
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

      // Add to dedup set so we don't write the same link again in this batch
      if (item.link) existingLinks.add(item.link);

      if (writtenFileName) {
        count++;

        // Trigger digest generation if autoDigest is enabled
        try {
          const settings = await loadSettings();
          if (settings.digest?.autoDigest) {
            enqueue('inbox_digest', { fileName: writtenFileName });
          }
        } catch (err) {
          logger.warn('RSS', `Failed to enqueue digest task: ${(err as Error).message}`);
        }
      }
    }

    return { count, latestPubDate };
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
}

export async function importOPML(xml: string): Promise<{ added: number; errors: string[] }> {
  let feeds: OPMLFeed[];
  try {
    feeds = parseOPML(xml);
  } catch (err: any) {
    return { added: 0, errors: [err.message] };
  }
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
    const { count, latestPubDate } = await processFeedItems(url, name, items, source?.lastPubDate);

    if (source) {
      source.lastChecked = new Date().toISOString();
      source.lastEntryCount = items.length;
      if (latestPubDate) {
        source.lastPubDate = latestPubDate;
      }
      await saveSources(sources);
    }

    return { url, name, newItems: count };
  } catch (err: any) {
    return { url, name, newItems: 0, error: err.message };
  }
}

export async function checkAllFeeds(): Promise<CheckResult[]> {
  const sources = await loadSources();
  return Promise.all(sources.map(source => checkFeed(source.url)));
}

/** Manual RSS ingest (e.g. from ChatPanel). Respects lastPubDate if feed is subscribed. */
export async function ingestRSSItems(
  url: string,
  name: string,
  items: RSSItem[],
  maxItems?: number
): Promise<{ title: string; link: string }[]> {
  const sources = await loadSources();
  const source = sources.find(s => s.url === url);
  const { count, latestPubDate } = await processFeedItems(url, name, items, source?.lastPubDate, maxItems);

  if (source && latestPubDate && latestPubDate !== source.lastPubDate) {
    source.lastPubDate = latestPubDate;
    await saveSources(sources);
  }

  // Return all items up to maxItems for display, regardless of whether they were skipped
  return items.slice(0, maxItems ?? items.length).map(item => ({ title: item.title, link: item.link }));
}
