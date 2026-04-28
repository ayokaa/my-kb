
import { join, dirname } from 'path';
import { readFile, writeFile, rename, mkdir, stat } from 'fs/promises';
import { randomUUID } from 'crypto';
import type { InboxEntry, SourceType } from './types';
import { processInboxEntry } from './cognition/ingest';
import { FileSystemStorage } from './storage';
import { fetchRSS } from './ingestion/rss';
import { fetchWebContent } from './ingestion/web';
import { ingestRSSItems, checkFeed } from './rss/manager';
import { parseInboxEntry } from './parsers';
import { broadcastNoteChanged } from './events';

function broadcastTaskChanged() {
  broadcastNoteChanged();
}
import { runRelinkJob } from './cognition/relink';
import { logger } from './logger';

export type TaskType = 'ingest' | 'rss_fetch' | 'web_fetch' | 'relink';

export interface IngestPayload {
  fileName?: string;
  title?: string;
  content?: string;
  sourceType?: SourceType;
  rawMetadata?: Record<string, unknown>;
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

export interface RelinkPayload {}

export type TaskPayload = IngestPayload | RSSFetchPayload | WebFetchPayload | RelinkPayload;

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
  relink: [],
};
const workerRunningByType: Record<TaskType, boolean> = {
  ingest: false,
  rss_fetch: false,
  web_fetch: false,
  relink: false,
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
        // Retain the most recent 100 tasks, but never drop pending/running ones
        const allTasks = Array.from(tasks.values());
        const activeTasks = allTasks.filter((t) => t.status === 'pending' || t.status === 'running');
        const doneTasks = allTasks.filter((t) => t.status !== 'pending' && t.status !== 'running');
        const trimmedDone = doneTasks
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, Math.max(0, 100 - activeTasks.length));
        const trimmedTasks = [...activeTasks, ...trimmedDone];

        const state = {
          tasks: trimmedTasks,
          pendingIds: (['ingest', 'rss_fetch', 'web_fetch', 'relink'] as TaskType[]).flatMap((t) => pendingByType[t]),
        };
        const tmp = `${queuePath}.tmp.${Date.now()}`;
        await writeFile(tmp, JSON.stringify(state, null, 2));
        await rename(tmp, queuePath);
      } catch (err) {
        logger.error('Queue', `Failed to save state: ${(err as Error).message}`);
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
    // Also recover any running tasks that were in progress during shutdown
    for (const t of state.tasks || []) {
      const taskType = t.type as TaskType;
      if (t.status === 'running' && !pendingByType[taskType].includes(t.id)) {
        t.status = 'pending';
        pendingByType[taskType].push(t.id);
      }
    }
    const totalPending = pendingByType.ingest.length + pendingByType.rss_fetch.length + pendingByType.web_fetch.length + pendingByType.relink.length;
    logger.info('Queue', `Restored ${totalPending} pending tasks`);
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
  logger.info('Queue', `Enqueued ${type} task ${id}`);
  saveQueueState();
  broadcastTaskChanged();
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

/** Return pending/running tasks that directly affect the inbox (ingest, web_fetch & rss_fetch).
 */
export function listInboxPending(): Task[] {
  return listPending().filter((t) => t.type === 'ingest' || t.type === 'web_fetch' || t.type === 'rss_fetch');
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
  logger.info('Queue', `Worker started for ${type}`);

  const pendingIds = pendingByType[type];
  while (pendingIds.length > 0) {
    const id = pendingIds.shift()!;
    const task = tasks.get(id);
    if (!task) continue;

    task.status = 'running';
    task.startedAt = new Date().toISOString();
    saveQueueState();
    broadcastTaskChanged();

    try {
      if (task.type === 'ingest') {
        const result = await runIngestTask(task.payload as IngestPayload);
        task.status = 'done';
        task.result = result || { ok: true };
        logger.info('Queue', `Task ${id} completed ${(result as any)?.skipped ? '(skipped)' : ''}`);
      } else if (task.type === 'rss_fetch') {
        const result = await runRSSFetchTask(task.payload as RSSFetchPayload);
        task.status = 'done';
        task.result = result;
        logger.info('Queue', `Task ${id} RSS fetch completed ${(result as any).newItems !== undefined ? `(${(result as any).newItems} new items)` : ''}`);
      } else if (task.type === 'web_fetch') {
        const result = await runWebFetchTask(task.payload as WebFetchPayload);
        task.status = 'done';
        task.result = result;
        logger.info('Queue', `Task ${id} web fetch completed ${(result as any).title || ''}`);
      } else if (task.type === 'relink') {
        const result = await runRelinkTask();
        task.status = 'done';
        task.result = result;
        logger.info('Queue', `Task ${id} relink completed ${JSON.stringify(result)}`);
      }
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : 'Unknown error';
      logger.error('Queue', `Task ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    task.completedAt = new Date().toISOString();
    saveQueueState();
  }

  workerRunningByType[type] = false;
  logger.info('Queue', `Worker idle for ${type}`);
}

/** Explicitly initialize queue: restore persisted state and auto-start worker if needed.
 *  Safe to call multiple times (subsequent calls are no-ops).
 */
export function initQueue() {
  if (workerInitialized) return;
  workerInitialized = true;
  loadQueueState().then(() => {
    for (const type of ['ingest', 'rss_fetch', 'web_fetch', 'relink'] as TaskType[]) {
      if (pendingByType[type].length > 0) {
        logger.info('Queue', `Auto-starting worker for ${type} with ${pendingByType[type].length} restored tasks`);
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

  const entry: InboxEntry = {
    sourceType: 'web',
    title: web.title || url,
    content: web.content || '',
    rawMetadata: { source_url: url, excerpt: web.excerpt },
    extractedAt: new Date().toISOString(),
  };

  const existingNotes = await storage.listNotes();
  const { note } = await processInboxEntry(entry, existingNotes);
  await storage.saveNote(note, { skipBacklinkRebuild: true });
  await storage.rebuildBacklinks();
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

async function runRelinkTask() {
  const storage = new FileSystemStorage();
  const result = await runRelinkJob(
    () => storage.listNotes(),
    (note) => storage.saveNote(note, { skipBacklinkRebuild: true })
  );
  await storage.rebuildBacklinks();
  return result;
}

async function runIngestTask(payload: IngestPayload) {
  // Direct ingest without inbox file
  if (payload.title !== undefined && payload.content !== undefined) {
    const entry: InboxEntry = {
      sourceType: payload.sourceType || 'text',
      title: payload.title,
      content: payload.content,
      rawMetadata: payload.rawMetadata || {},
      extractedAt: new Date().toISOString(),
    };

    const storage = new FileSystemStorage();
    const existingNotes = await storage.listNotes();
    const { note } = await processInboxEntry(entry, existingNotes);
    await storage.saveNote(note, { skipBacklinkRebuild: true });
    await storage.rebuildBacklinks();
    broadcastNoteChanged();
    return { ok: true, title: note.title };
  }

  // Legacy: ingest from inbox file
  const { fileName } = payload;
  if (!fileName) {
    throw new Error('Invalid ingest payload: need fileName or title+content');
  }

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
      logger.info('Queue', `Duplicate source detected: ${originalUrl}, archiving ${fileName}`);
      await storage.archiveInbox(fileName);
      return { skipped: true, reason: 'duplicate source' };
    }
  }

  const existingNotes = await storage.listNotes();
  const { note } = await processInboxEntry(entry, existingNotes);
  await storage.saveNote(note, { skipBacklinkRebuild: true });
  await storage.archiveInbox(fileName);
  broadcastNoteChanged();
  await storage.rebuildBacklinks();
}
