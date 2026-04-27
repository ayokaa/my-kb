
import { join, dirname } from 'path';
import { readFile, writeFile, rename, mkdir, stat } from 'fs/promises';
import { randomUUID } from 'crypto';
import type { InboxEntry } from './types';
import { processInboxEntry } from './cognition/ingest';
import { FileSystemStorage } from './storage';
import { fetchRSS } from './ingestion/rss';
import { fetchWebContent } from './ingestion/web';
import { ingestRSSItems, checkFeed } from './rss/manager';
import { parseInboxEntry } from './parsers';
import { broadcastNoteChanged } from './events';

export type TaskType = 'ingest' | 'rss_fetch' | 'web_fetch';

export interface IngestPayload {
  fileName: string;
}

export interface RSSFetchPayload {
  url: string;
  name?: string;
  maxItems?: number;
  isSubscriptionCheck?: boolean;
}

export interface WebFetchPayload {
  url: string;
}

export type TaskPayload = IngestPayload | RSSFetchPayload | WebFetchPayload;

export interface Task {
  id: string;
  type: TaskType;
  payload: TaskPayload;
  status: 'pending' | 'running' | 'done' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: unknown;
}

const tasks = new Map<string, Task>();
const pendingByType: Record<TaskType, string[]> = {
  ingest: [],
  rss_fetch: [],
  web_fetch: [],
};
const workerRunningByType: Record<TaskType, boolean> = {
  ingest: false,
  rss_fetch: false,
  web_fetch: false,
};
let saveLock: Promise<void> = Promise.resolve();
let workerInitialized = false;

function getKnowledgeRoot(): string {
  return process.env.KNOWLEDGE_ROOT || 'knowledge';
}

function getQueuePath(): string {
  return join(process.cwd(), getKnowledgeRoot(), 'meta', 'queue.json');
}

async function saveQueueState() {
  saveLock = saveLock
    .then(async () => {
      const queuePath = getQueuePath();
      try {
        await mkdir(dirname(queuePath), { recursive: true });
        const state = {
          tasks: Array.from(tasks.values()),
          pendingIds: (['ingest', 'rss_fetch', 'web_fetch'] as TaskType[]).flatMap((t) => pendingByType[t]),
        };
        const tmp = `${queuePath}.tmp.${Date.now()}`;
        await writeFile(tmp, JSON.stringify(state, null, 2));
        await rename(tmp, queuePath);
      } catch (err) {
        console.error('[Queue] Failed to save state:', (err as Error).message);
      }
    })
    .catch(() => {
      // Errors are logged inside; keep the chain alive
    });
  await saveLock;
}

async function loadQueueState() {
  try {
    const raw = await readFile(getQueuePath(), 'utf-8');
    const state = JSON.parse(raw);
    for (const t of state.tasks || []) {
      tasks.set(t.id, t);
    }
    for (const id of state.pendingIds || []) {
      const task = tasks.get(id);
      if (task && (task.status === 'pending' || task.status === 'running')) {
        task.status = 'pending';
        pendingByType[task.type].push(id);
      }
    }
    const totalPending = pendingByType.ingest.length + pendingByType.rss_fetch.length + pendingByType.web_fetch.length;
    console.log(`[Queue] Restored ${totalPending} pending tasks`);
  } catch {
    // No state file, start fresh
  }
}

function generateId(): string {
  return `task-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function enqueue(type: TaskType, payload: TaskPayload): string {
  const id = generateId();
  const task: Task = {
    id,
    type,
    payload,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  tasks.set(id, task);
  pendingByType[type].push(id);
  console.log(`[Queue] Enqueued ${type} task ${id}`);
  saveQueueState();
  startWorker(type);
  return id;
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function listTasks(limit = 50): Task[] {
  return Array.from(tasks.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function listPending(): Task[] {
  return listTasks().filter((t) => t.status === 'pending' || t.status === 'running');
}

/** Return pending/running tasks that directly affect the inbox (ingest & web_fetch).
 *  rss_fetch is excluded because it's a background cron job unrelated to user inbox actions.
 */
export function listInboxPending(): Task[] {
  return listPending().filter((t) => t.type === 'ingest' || t.type === 'web_fetch');
}

export function retryTask(id: string): Task | null {
  const task = tasks.get(id);
  if (!task || task.status !== 'failed') return null;

  task.status = 'pending';
  task.error = undefined;
  task.startedAt = undefined;
  task.completedAt = undefined;
  task.result = undefined;
  pendingByType[task.type].push(id);
  saveQueueState();
  startWorker(task.type);
  return task;
}

/* ---------- Worker ---------- */

async function startWorker(type: TaskType) {
  if (workerRunningByType[type]) return;
  workerRunningByType[type] = true;
  console.log(`[Queue] Worker started for ${type}`);

  const pendingIds = pendingByType[type];
  while (pendingIds.length > 0) {
    const id = pendingIds.shift()!;
    const task = tasks.get(id);
    if (!task) continue;

    task.status = 'running';
    task.startedAt = new Date().toISOString();
    saveQueueState();

    try {
      if (task.type === 'ingest') {
        const result = await runIngestTask(task.payload);
        task.status = 'done';
        task.result = result || { ok: true };
        console.log(`[Queue] Task ${id} completed`, result?.skipped ? '(skipped)' : '');
      } else if (task.type === 'rss_fetch') {
        const result = await runRSSFetchTask(task.payload);
        task.status = 'done';
        task.result = result;
        console.log(`[Queue] Task ${id} RSS fetch completed`, result.newItems !== undefined ? `(${result.newItems} new items)` : '');
      } else if (task.type === 'web_fetch') {
        const result = await runWebFetchTask(task.payload);
        task.status = 'done';
        task.result = result;
        console.log(`[Queue] Task ${id} web fetch completed`, result.title || '');
      }
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Queue] Task ${id} failed:`, err);
    }
    task.completedAt = new Date().toISOString();
    saveQueueState();
  }

  workerRunningByType[type] = false;
  console.log(`[Queue] Worker idle for ${type}`);
}

/** Explicitly initialize queue: restore persisted state and auto-start worker if needed.
 *  Safe to call multiple times (subsequent calls are no-ops).
 */
export function initQueue() {
  if (workerInitialized) return;
  workerInitialized = true;
  loadQueueState().then(() => {
    for (const type of ['ingest', 'rss_fetch', 'web_fetch'] as TaskType[]) {
      if (pendingByType[type].length > 0) {
        console.log(`[Queue] Auto-starting worker for ${type} with ${pendingByType[type].length} restored tasks`);
        startWorker(type);
      }
    }
  });
}

/* ---------- Task handlers ---------- */



async function runWebFetchTask(payload: WebFetchPayload) {
  const { url } = payload;
  const web = await fetchWebContent(url);
  const storage = new FileSystemStorage();
  await storage.writeInbox({
    sourceType: 'web',
    title: web.title,
    content: web.content,
    rawMetadata: { source_url: url, excerpt: web.excerpt },
  });
  broadcastNoteChanged();
  return { ok: true, title: web.title, url };
}

async function runRSSFetchTask(payload: RSSFetchPayload) {
  const { url, name, maxItems, isSubscriptionCheck } = payload;

  if (isSubscriptionCheck) {
    return await checkFeed(url);
  }

  const items = await fetchRSS(url);
  const entries = await ingestRSSItems(url, name || url, items, maxItems);
  return { count: entries.length, url, name: name || url };
}

async function runIngestTask(payload: IngestPayload) {
  const { fileName } = payload;
  const filePath = join(process.cwd(), getKnowledgeRoot(), 'inbox', fileName);

  try {
    await stat(filePath);
  } catch {
    throw new Error(`Inbox file not found: ${fileName}`);
  }

  const raw = await readFile(filePath, 'utf-8');
  const entry = parseInboxEntry(raw, filePath);

  const originalUrl = (entry.rawMetadata?.rss_link || entry.rawMetadata?.source_url) as string | undefined;

  const storage = new FileSystemStorage();

  // Check for duplicate source URL in existing notes (light-weight frontmatter scan)
  if (originalUrl) {
    const noteSources = await storage.listNoteSources();
    const hasDuplicate = noteSources.some((ns) => ns.sources.includes(originalUrl));
    if (hasDuplicate) {
      console.log(`[Queue] Duplicate source detected: ${originalUrl}, archiving ${fileName}`);
      await storage.archiveInbox(fileName);
      return { skipped: true, reason: 'duplicate source' };
    }
  }

  const existingNotes = await storage.listNotes();
  const existingTitles = existingNotes.map((n) => n.title);
  const { note } = await processInboxEntry(entry, existingTitles);
  await storage.saveNote(note);
  await storage.archiveInbox(fileName);
  broadcastNoteChanged();
}
