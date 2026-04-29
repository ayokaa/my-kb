
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
import { emitNoteEvent, emitTaskEvent } from './events';

// broadcastTaskChanged 已移除，改由 worker 中直接调用 emitTaskEvent
import { runRelinkJob } from './cognition/relink';
import { logger } from './logger';

export type TaskType = 'ingest' | 'rss_fetch' | 'web_fetch' | 'relink';

export interface IngestPayload {
  fileName?: string;
  title?: string;
  content?: string;
  sourceType?: SourceType;
  rawMetadata?: Record<string, unknown>;
  userHint?: string;  // 用户提供的提示词，引导 LLM 提取方向
}

export interface RSSFetchPayload {
  url: string;
  name?: string;
  maxItems?: number;
  isSubscriptionCheck?: boolean;
}

export interface WebFetchPayload {
  url: string;
  userHint?: string;
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
  /** 任务重试时保留——避免重复执行昂贵操作（如浏览器抓取） */
  taskCache?: Record<string, unknown>;
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
let saveInProgress = false;
let saveRequested = false;
let workerInitialized = false;
let lastCleanup = Date.now();
const MAX_INMEMORY_TASKS = 200;
const TASK_CLEANUP_AGE_MS = 3_600_000; // 1 hour — remove completed tasks older than this

function getKnowledgeRoot(): string {
  return process.env.KNOWLEDGE_ROOT || 'knowledge';
}

function getQueuePath(): string {
  return join(process.cwd(), getKnowledgeRoot(), 'meta', 'queue.json');
}

/** Prune old completed/failed tasks from the in-memory Map to limit memory growth.
 *  Only runs periodically (not on every save) to avoid overhead. */
function pruneOldTasks() {
  const now = Date.now();
  if (now - lastCleanup < 300_000) return; // at most every 5 minutes
  if (tasks.size <= MAX_INMEMORY_TASKS) return; // only clean up when over threshold
  lastCleanup = now;

  const cutoff = new Date(now - TASK_CLEANUP_AGE_MS).toISOString();
  for (const [id, task] of tasks) {
    if (task.status === 'done' || task.status === 'failed') {
      const completedAt = task.completedAt || task.createdAt;
      if (completedAt < cutoff) {
        tasks.delete(id);
      }
    }
  }
}

/** Persist the current queue state to disk atomically.
 *
 *  Debounces rapid calls: if a save is already in-flight, marks a follow-up
 *  save as needed and returns immediately.  This avoids the unbounded
 *  promise-chain growth (saveLock = saveLock.then(…)) and coalesces bursts
 *  of enqueue() calls (e.g. 26 RSS sources at the top of the hour) into at
 *  most 2 disk writes instead of 26.
 */
async function saveQueueState() {
  if (saveInProgress) {
    saveRequested = true;
    return;
  }

  saveInProgress = true;
  try {
    do {
      saveRequested = false;
      pruneOldTasks();
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
    } while (saveRequested);
  } finally {
    saveInProgress = false;
  }
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
  emitTaskEvent('started', id, type);
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
  // taskCache 保留——避免重试时重复执行昂贵操作（如浏览器抓取）
  pendingByType[task.type].push(id);
  saveQueueState();
  emitTaskEvent('started', id, task.type);
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
    emitTaskEvent('started', id, type);

    try {
      if (task.type === 'ingest') {
        const result = await runIngestTask(task.payload as IngestPayload);
        task.status = 'done';
        task.result = result || { ok: true };
        logger.info('Queue', `Task ${id} completed ${(result as any)?.skipped ? '(skipped)' : ''}`);
        emitTaskEvent('completed', id, type, undefined, result);
      } else if (task.type === 'rss_fetch') {
        const result = await runRSSFetchTask(task.payload as RSSFetchPayload);
        task.status = 'done';
        task.result = result;
        logger.info('Queue', `Task ${id} RSS fetch completed ${(result as any).newItems !== undefined ? `(${(result as any).newItems} new items)` : ''}`);
        emitTaskEvent('completed', id, type, undefined, result);
      } else if (task.type === 'web_fetch') {
        const result = await runWebFetchTask(task.payload as WebFetchPayload, task);
        task.status = 'done';
        task.result = result;
        logger.info('Queue', `Task ${id} web fetch completed ${(result as any).title || ''}`);
        emitTaskEvent('completed', id, type, undefined, result);
      } else if (task.type === 'relink') {
        const result = await runRelinkTask();
        task.status = 'done';
        task.result = result;
        logger.info('Queue', `Task ${id} relink completed ${JSON.stringify(result)}`);
        emitTaskEvent('completed', id, type, undefined, result);
      }
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : 'Unknown error';
      logger.error('Queue', `Task ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
      emitTaskEvent('failed', id, type, task.error);
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



async function runWebFetchTask(payload: WebFetchPayload, task?: Task) {
  const { url } = payload;
  const storage = new FileSystemStorage();

  // 检查已有笔记的 sources 是否包含此 URL
  const noteSources = await storage.listNoteSources();
  if (noteSources.some((ns) => ns.sources.includes(url))) {
    logger.info('Queue', `Duplicate source URL detected: ${url}, skipping web_fetch`);
    return { skipped: true, reason: 'duplicate source', url };
  }

  // 重试时优先使用缓存，避免重复抓取
  let title: string;
  let content: string;
  if (task?.taskCache?.webContent) {
    const cached = task.taskCache.webContent as { title: string; content: string };
    title = cached.title;
    content = cached.content;
    logger.info('Queue', `Using cached web fetch for ${url}`);
  } else {
    const web = await fetchWebContent(url);
    title = web.title || url;
    content = web.content || '';
    // 缓存抓取结果，供重试时复用
    task.taskCache = { webContent: { title, content } };
  }

  const entry: InboxEntry = {
    sourceType: 'web',
    title,
    content,
    // 不传 source_url 到 rawMetadata —— 避免 enrichContent 重复抓取同一 URL
    rawMetadata: {
      excerpt: '',
      userHint: payload.userHint,
    },
    extractedAt: new Date().toISOString(),
  };

  const existingNotes = await storage.listNotes();
  const { note } = await processInboxEntry(entry, existingNotes);
  // 手动补上 source URL（processInboxEntry 不处理不带 source_url 的 entry）
  if (!note.sources.includes(url)) {
    note.sources.push(url);
  }
  await storage.saveNote(note, { skipBacklinkRebuild: true });
  await storage.rebuildBacklinks();
  emitNoteEvent('created', note.id, note.title);
  return { ok: true, title, url };
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
    const storage = new FileSystemStorage();

    // 检查已有笔记的 sources 是否包含此 URL
    const sourceUrl = payload.rawMetadata?.source_url as string | undefined;
    if (sourceUrl) {
      const noteSources = await storage.listNoteSources();
      if (noteSources.some((ns) => ns.sources.includes(sourceUrl))) {
        logger.info('Queue', `Duplicate source URL detected: ${sourceUrl}, skipping ingest`);
        return { skipped: true, reason: 'duplicate source' };
      }
    }

    const entry: InboxEntry = {
      sourceType: payload.sourceType || 'text',
      title: payload.title,
      content: payload.content,
      rawMetadata: {
        ...payload.rawMetadata,
        userHint: payload.userHint,
      },
      extractedAt: new Date().toISOString(),
    };

    const existingNotes = await storage.listNotes();
    const { note } = await processInboxEntry(entry, existingNotes);
    await storage.saveNote(note, { skipBacklinkRebuild: true });
    await storage.rebuildBacklinks();
    emitNoteEvent('created', note.id, note.title);
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

  // 用户提示词注入到 rawMetadata
  if (payload.userHint) {
    entry.rawMetadata.userHint = payload.userHint;
  }

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
  emitNoteEvent('created', note.id, note.title);
  await storage.rebuildBacklinks();
}
