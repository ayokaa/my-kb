import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
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

const KNOWLEDGE_ROOT = process.env.KNOWLEDGE_ROOT || 'knowledge';
const QUEUE_PATH = join(process.cwd(), KNOWLEDGE_ROOT, 'meta', 'queue.json');

async function saveQueueState() {
  try {
    await mkdir(dirname(QUEUE_PATH), { recursive: true });
    const state = {
      tasks: Array.from(tasks.values()),
      pendingIds: [...pendingIds],
    };
    const tmp = `${QUEUE_PATH}.tmp.${Date.now()}`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, QUEUE_PATH);
  } catch (err) {
    console.error('[Queue] Failed to save state:', (err as Error).message);
  }
}

async function loadQueueState() {
  try {
    const raw = await readFile(QUEUE_PATH, 'utf-8');
    const state = JSON.parse(raw);
    for (const t of state.tasks || []) {
      tasks.set(t.id, t);
    }
    for (const id of state.pendingIds || []) {
      const task = tasks.get(id);
      if (task && (task.status === 'pending' || task.status === 'running')) {
        task.status = 'pending';
        pendingIds.push(id);
      }
    }
    console.log(`[Queue] Restored ${pendingIds.length} pending tasks`);
  } catch {
    // No state file, start fresh
  }
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
  saveQueueState();
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
    saveQueueState();

    try {
      if (task.type === 'ingest') {
        const result = await runIngestTask(task.payload);
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
    saveQueueState();
  }

  workerRunning = false;
  console.log('[Queue] Worker idle');
}

// Restore state on module load
loadQueueState().then(() => {
  if (pendingIds.length > 0) {
    console.log(`[Queue] Auto-starting worker with ${pendingIds.length} restored tasks`);
    startWorker();
  }
});

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

async function runIngestTask(payload: { fileName: string }) {
  const { fileName } = payload;
  const filePath = join(process.cwd(), KNOWLEDGE_ROOT, 'inbox', fileName);

  const raw = await readFile(filePath, 'utf-8');
  const entry = parseInboxRaw(raw, filePath);

  const originalUrl = (entry.rawMetadata?.rss_link || entry.rawMetadata?.source_url) as string | undefined;

  const storage = new FileSystemStorage();

  // Check for duplicate source URL in existing notes
  if (originalUrl) {
    const notes = await storage.listNotes();
    const hasDuplicate = notes.some((note) => note.sources.includes(originalUrl));
    if (hasDuplicate) {
      console.log(`[Queue] Duplicate source detected: ${originalUrl}, archiving ${fileName}`);
      await storage.archiveInbox(fileName);
      return { skipped: true, reason: 'duplicate source' };
    }
  }

  const { note } = await processInboxEntry(entry);
  await storage.saveNote(note);
  await storage.archiveInbox(fileName);
}
