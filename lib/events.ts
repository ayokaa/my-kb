import type { TaskType } from './queue';

// ── SSE 事件类型 ──────────────────────────────────────────────

export interface NoteEvent {
  action: 'created' | 'updated' | 'deleted';
  id: string;
  title: string;
}

export interface TaskEvent {
  action: 'started' | 'completed' | 'failed';
  id: string;
  type: TaskType;
  error?: string;
  result?: unknown;
}

export interface InboxEvent {
  action: 'new' | 'processed';
  count?: number;  // 可选——前端收到事件后自行 fetch 实际计数
}

// ── SSE 控制器管理 ────────────────────────────────────────────

const controllers = new Set<ReadableStreamDefaultController>();
const MAX_CONTROLLERS = 50;

const encoder = new TextEncoder();

function cleanupStaleControllers() {
  const heartbeat = encoder.encode(':ok\n\n');
  for (const controller of controllers) {
    try {
      controller.enqueue(heartbeat);
    } catch {
      controllers.delete(controller);
    }
  }
}

// ── 公共 API ──────────────────────────────────────────────────

/** 编码结构化事件为 SSE 文本行 */
function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 广播笔记变更事件 */
export function emitNoteEvent(action: NoteEvent['action'], id: string, title: string) {
  if (controllers.size === 0) return;
  if (controllers.size > MAX_CONTROLLERS) cleanupStaleControllers();

  const raw = formatSSE('note', { action, id, title } satisfies NoteEvent);
  const message = encoder.encode(raw);
  for (const controller of controllers) {
    try {
      controller.enqueue(message);
    } catch {
      controllers.delete(controller);
    }
  }
}

/** 广播任务状态变更事件 */
export function emitTaskEvent(action: TaskEvent['action'], id: string, type: TaskType, error?: string, result?: unknown) {
  if (controllers.size === 0) return;
  if (controllers.size > MAX_CONTROLLERS) cleanupStaleControllers();

  const raw = formatSSE('task', { action, id, type, error, result } satisfies TaskEvent);
  const message = encoder.encode(raw);
  for (const controller of controllers) {
    try {
      controller.enqueue(message);
    } catch {
      controllers.delete(controller);
    }
  }
}

/** 广播收件箱变更事件 */
export function emitInboxEvent(action: InboxEvent['action'], count?: number) {
  if (controllers.size === 0) return;
  if (controllers.size > MAX_CONTROLLERS) cleanupStaleControllers();

  const raw = formatSSE('inbox', { action, count } satisfies InboxEvent);
  const message = encoder.encode(raw);
  for (const controller of controllers) {
    try {
      controller.enqueue(message);
    } catch {
      controllers.delete(controller);
    }
  }
}

/** 向后兼容：保持旧函数签名供测试使用 */
export function broadcastNoteChanged() {
  // 通用变更信号，不包含具体 payload
  const message = encoder.encode('data: changed\n\n');
  for (const controller of controllers) {
    try {
      controller.enqueue(message);
    } catch {
      controllers.delete(controller);
    }
  }
}

/** 注册 SSE 控制器 */
export function addNoteEventController(controller: ReadableStreamDefaultController) {
  if (controllers.size >= MAX_CONTROLLERS) cleanupStaleControllers();
  controllers.add(controller);
}

/** 移除 SSE 控制器 */
export function removeNoteEventController(controller: ReadableStreamDefaultController) {
  controllers.delete(controller);
}
