import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { logger } from './logger';
import type { NoteStatus } from './types';

// ── 类型 ────────────────────────────────────────────────────

export interface UserProfile {
  role?: string;
  techStack: string[];
  interests: string[];
  background?: string;
  updatedAt?: string;
}

export interface NoteKnowledge {
  level: 'aware' | 'referenced' | 'discussed';
  firstSeenAt: string;
  lastReferencedAt: string;
  notes: string;
}

export interface ConversationDigestEntry {
  conversationId: string;
  summary: string;
  topics: string[];
  timestamp: string;
}

export interface UserMemory {
  profile: UserProfile;
  noteKnowledge: Record<string, NoteKnowledge>;
  conversationDigest: ConversationDigestEntry[];
  preferences: Record<string, unknown>;
  updatedAt: string;
}

/** LLM 提取的输出格式 */
export interface MemoryExtractResult {
  profileChanges?: Partial<UserProfile>;
  noteFamiliarity?: Array<{
    noteId: string;
    level: NoteKnowledge['level'];
    notes: string;
  }>;
  conversationDigest?: {
    summary: string;
    topics: string[];
  };
  preferenceSignals?: Record<string, unknown>;
}

// ── 存储路径 ────────────────────────────────────────────────

function getKnowledgeRoot(): string {
  return process.env.KNOWLEDGE_ROOT || 'knowledge';
}

function getMemoryPath(): string {
  return join(process.cwd(), getKnowledgeRoot(), 'meta', 'user-memory.json');
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${Date.now()}`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

// ── 公共 API ────────────────────────────────────────────────

export function emptyMemory(): UserMemory {
  return {
    profile: { techStack: [], interests: [] },
    noteKnowledge: {},
    conversationDigest: [],
    preferences: {},
    updatedAt: new Date().toISOString(),
  };
}

export async function loadMemory(): Promise<UserMemory> {
  try {
    const raw = await readFile(getMemoryPath(), 'utf-8');
    const parsed = JSON.parse(raw) as UserMemory;
    // 确保必要字段存在（向后兼容旧格式）
    return {
      ...emptyMemory(),
      ...parsed,
      profile: { ...emptyMemory().profile, ...parsed.profile },
    };
  } catch {
    return emptyMemory();
  }
}

export async function saveMemory(memory: UserMemory): Promise<void> {
  try {
    memory.updatedAt = new Date().toISOString();
    await atomicWrite(getMemoryPath(), JSON.stringify(memory, null, 2));
  } catch (err) {
    logger.error('Memory', `Failed to save: ${(err as Error).message}`);
  }
}

/**
 * 增量合并 LLM 提取的结果到现有记忆。
 * 不同字段有不同的合并策略。
 */
export function mergeMemory(current: UserMemory, extracted: MemoryExtractResult, conversationId: string): UserMemory {
  const now = new Date().toISOString();
  const merged = structuredClone(current);

  // 1. profileChanges：覆盖 + 去重追加
  if (extracted.profileChanges) {
    const p = extracted.profileChanges;
    if (p.role) merged.profile.role = p.role;
    if (p.background) merged.profile.background = p.background;
    if (p.techStack) {
      const existing = new Set(merged.profile.techStack);
      for (const t of p.techStack) existing.add(t);
      merged.profile.techStack = Array.from(existing);
    }
    if (p.interests) {
      const existing = new Set(merged.profile.interests);
      for (const i of p.interests) existing.add(i);
      merged.profile.interests = Array.from(existing);
    }
    merged.profile.updatedAt = now;
  }

  // 2. noteFamiliarity：per-note 覆盖
  if (extracted.noteFamiliarity) {
    for (const nf of extracted.noteFamiliarity) {
      const existing = merged.noteKnowledge[nf.noteId];
      merged.noteKnowledge[nf.noteId] = {
        level: nf.level,
        firstSeenAt: existing?.firstSeenAt || now,
        lastReferencedAt: now,
        notes: nf.notes,
      };
    }
  }

  // 3. conversationDigest：插入前面，保留最近 20 条
  if (extracted.conversationDigest) {
    merged.conversationDigest.unshift({
      conversationId,
      ...extracted.conversationDigest,
      timestamp: now,
    });
    if (merged.conversationDigest.length > 20) {
      merged.conversationDigest = merged.conversationDigest.slice(0, 20);
    }
  }

  // 4. preferenceSignals：覆盖
  if (extracted.preferenceSignals) {
    Object.assign(merged.preferences, extracted.preferenceSignals);
  }

  return merged;
}

/**
 * 构建注入 Chat system prompt 的上下文。
 * 按预算选择性注入。
 */
export function getChatContext(
  memory: UserMemory,
  relevantNoteIds: string[]
): string | null {
  if (!memory.profile.role && memory.profile.interests.length === 0 &&
      memory.conversationDigest.length === 0 && relevantNoteIds.length === 0) {
    return null; // 没有有意义的信息
  }

  const parts: string[] = ['【用户档案】'];
  const profileLines: string[] = [];

  if (memory.profile.role) profileLines.push(`角色: ${memory.profile.role}`);
  if (memory.profile.techStack.length > 0) profileLines.push(`技术栈: ${memory.profile.techStack.join(', ')}`);
  if (memory.profile.interests.length > 0) profileLines.push(`关注: ${memory.profile.interests.join(', ')}`);
  if (memory.profile.background) profileLines.push(`背景: ${memory.profile.background}`);

  if (memory.profile.role || memory.profile.techStack.length > 0 ||
      memory.profile.interests.length > 0 || memory.profile.background) {
    parts.push(profileLines.join('\n'));
  }

  // 偏好
  if (Object.keys(memory.preferences).length > 0) {
    const prefs = Object.entries(memory.preferences)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    parts.push(`偏好:\n${prefs}`);
  }

  // 最近 3 条对话摘要
  const recent = memory.conversationDigest.slice(0, 3);
  if (recent.length > 0) {
    parts.push('\n【最近讨论】');
    for (const d of recent) {
      parts.push(`- ${d.summary}`);
    }
  }

  // 相关笔记的认知
  if (relevantNoteIds.length > 0) {
    const relevant = relevantNoteIds
      .filter((id) => memory.noteKnowledge[id])
      .slice(0, 5);
    if (relevant.length > 0) {
      parts.push('\n【用户对相关笔记的认知】');
      for (const id of relevant) {
        const nk = memory.noteKnowledge[id];
        parts.push(`- "${id}": ${nk.level} — ${nk.notes}`);
      }
    }
  }

  return parts.join('\n');
}

// ── 笔记状态自动演进 ────────────────────────────────────────

export interface StatusChange {
  noteId: string;
  from: string;
  to: string;
}

/** 纯函数：根据 noteKnowledge 计算笔记应转换到的状态。返回 null 表示不变。 */
export function computeNoteStatus(
  currentStatus: NoteStatus,
  nk: NoteKnowledge | undefined,
  now: number
): NoteStatus | null {
  if (currentStatus === 'archived') return null;

  switch (currentStatus) {
    case 'seed':
      if (nk && nk.level !== 'aware') return 'growing';
      break;
    case 'growing':
      if (!nk) return 'seed';
      if (nk.level === 'discussed') return 'evergreen';
      break;
    case 'evergreen':
      if (!nk) return 'seed';
      if ((now - new Date(nk.lastReferencedAt).getTime()) > 30 * 86400000)
        return 'stale';
      break;
    case 'stale':
      if (!nk) return 'seed';
      return 'growing';
  }
  return null;
}

/**
 * 根据用户记忆中的 noteKnowledge 自动演进笔记状态。
 * 纯规则判断，不调用 LLM。
 */
export async function evolveNoteStatuses(memory: UserMemory): Promise<StatusChange[]> {
  // 动态 import 避免循环依赖
  const { FileSystemStorage } = await import('./storage');
  const storage = new FileSystemStorage();
  const notes = await storage.listNotes();
  const changes: StatusChange[] = [];
  const now = Date.now();

  for (const note of notes) {
    if (note.status === 'archived') continue;
    const nk = memory.noteKnowledge[note.id];
    const newStatus = computeNoteStatus(note.status, nk, now);

    if (newStatus && newStatus !== note.status) {
      changes.push({ noteId: note.id, from: note.status, to: newStatus });
      note.status = newStatus;
      await storage.saveNote(note, { skipBacklinkRebuild: true });
    }
  }

  if (changes.length > 0) {
    await storage.rebuildBacklinks();
  }

  return changes;
}
