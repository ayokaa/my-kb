import { readFile } from 'fs/promises';
import { join } from 'path';
import yaml from 'js-yaml';
import type { InboxEntry } from './types';
import { processInboxEntry } from './cognition/ingest';
import { FileSystemStorage } from './storage';

export type TaskType = 'ingest';

export interface Task {
  id: string;
  type: TaskType;
  payload: any;
  status: 'pending' | 'running' | 'done' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: any;
}

const tasks = new Map<string, Task>();
const pendingIds: string[] = [];
let workerRunning = false;

/** Set a custom archive dir for testing */
let _testArchiveDir: string | undefined;
export function _setArchiveDir(dir: string | undefined) {
  _testArchiveDir = dir;
}

function generateId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function enqueue(type: TaskType, payload: any): string {
  const id = generateId();
  const task: Task = {
    id,
    type,
    payload,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  tasks.set(id, task);
  pendingIds.push(id);
  console.log(`[Queue] Enqueued ${type} task ${id}`);
  startWorker();
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

/** Reset all queue state — only for testing */
export function _resetQueue() {
  tasks.clear();
  pendingIds.length = 0;
  workerRunning = false;
  _testArchiveDir = undefined;
}

/* ---------- Worker ---------- */

async function startWorker() {
  if (workerRunning) return;
  workerRunning = true;
  console.log('[Queue] Worker started');

  while (pendingIds.length > 0) {
    const id = pendingIds.shift()!;
    const task = tasks.get(id);
    if (!task) continue;

    task.status = 'running';
    task.startedAt = new Date().toISOString();

    try {
      if (task.type === 'ingest') {
        const result = await runIngestTask(task.payload, _testArchiveDir);
        task.status = 'done';
        task.result = result || { ok: true };
        console.log(`[Queue] Task ${id} completed`, result?.skipped ? '(skipped)' : '');
      }
    } catch (err: any) {
      task.status = 'failed';
      task.error = err.message;
      console.error(`[Queue] Task ${id} failed:`, err.message);
    }
    task.completedAt = new Date().toISOString();
  }

  workerRunning = false;
  console.log('[Queue] Worker idle');
}

/* ---------- Task handlers ---------- */

export function parseInboxRaw(raw: string, path: string): InboxEntry {
  const parts = raw.split('---');
  if (parts.length < 3) {
    return {
      sourceType: 'text',
      title: path.split('/').pop()?.replace('.md', '') || 'untitled',
      content: raw,
      rawMetadata: {},
      filePath: path,
    };
  }
  const fm = yaml.load(parts[1].trim()) as Record<string, unknown>;
  const content = parts.slice(2).join('---').trim();
  const rawMetadata: Record<string, unknown> = {};
  const known = new Set(['source_type', 'source_path', 'title', 'extracted_at']);
  for (const [k, v] of Object.entries(fm)) {
    if (!known.has(k)) rawMetadata[k] = v;
  }
  return {
    sourceType: String(fm.source_type || 'text') as InboxEntry['sourceType'],
    sourcePath: fm.source_path as string | undefined,
    title: String(fm.title || 'untitled'),
    content,
    extractedAt: fm.extracted_at as string | undefined,
    rawMetadata,
    filePath: path,
  };
}

export async function runIngestTask(payload: { fileName: string }, archiveDir?: string) {
  const { fileName } = payload;
  // The process route already archived the file, so read from archive directory
  const base = archiveDir || join(process.cwd(), 'knowledge', 'archive', 'inbox');
  const filePath = join(base, fileName);

  const raw = await readFile(filePath, 'utf-8');
  const entry = parseInboxRaw(raw, filePath);

  const originalUrl = (entry.rawMetadata?.rss_link || entry.rawMetadata?.source_url) as string | undefined;

  const storage = new FileSystemStorage();

  // Check for duplicate source URL in existing notes
  if (originalUrl) {
    const notes = await storage.listNotes();
    const hasDuplicate = notes.some((note) => note.sources.includes(originalUrl));
    if (hasDuplicate) {
      console.log(`[Queue] Duplicate source detected: ${originalUrl}, skipping ${fileName}`);
      return { skipped: true, reason: 'duplicate source' };
    }
  }

  const { note } = await processInboxEntry(entry);
  await storage.saveNote(note);
  // File is already in archive, no need to archive again
}
