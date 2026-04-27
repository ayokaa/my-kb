import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { buildIndex } from './inverted-index';
import type { InvertedIndexMap } from './types';
import type { Note } from '../types';
import type { FileSystemStorage } from '../storage';

let cachedIndex: InvertedIndexMap | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5000;
let loadPromise: Promise<InvertedIndexMap> | null = null;

/**
 * 加载或构建搜索索引。
 * - 优先使用内存缓存（带 TTL）
 * - 其次读取 search-index.json
 * - 最后全量重建（复用传入的 notes 避免重复 listNotes）
 */
export async function loadOrBuildIndex(storage: FileSystemStorage, notes?: Note[]): Promise<InvertedIndexMap> {
  const now = Date.now();

  // 1. 内存缓存命中且未过期
  if (cachedIndex && now - cachedAt < CACHE_TTL_MS) {
    return cachedIndex;
  }

  // 2. 避免并发加载/重建（多个请求同时进来只触发一次）
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = doLoadOrBuild(storage, notes);
  try {
    const result = await loadPromise;
    return result;
  } finally {
    loadPromise = null;
  }
}

async function doLoadOrBuild(storage: FileSystemStorage, notes?: Note[]): Promise<InvertedIndexMap> {
  const root = storage.getRoot();
  const indexPath = join(root, 'meta', 'search-index.json');

  // 3. 尝试从文件加载
  try {
    const raw = await readFile(indexPath, 'utf-8');
    const { deserializeIndex } = await import('./inverted-index');
    const parsed = deserializeIndex(raw);
    if (parsed) {
      cachedIndex = parsed.index;
      cachedAt = Date.now();
      return cachedIndex;
    }
  } catch {
    // 文件不存在或损坏，继续重建
  }

  // 4. 全量重建（复用传入的 notes，避免和外部 listNotes 重复）
  const noteList = notes || await storage.listNotes();
  const index = buildIndex(noteList);
  cachedIndex = index;
  cachedAt = Date.now();

  // 5. 异步持久化到文件（不阻塞响应）
  (async () => {
    try {
      const { serializeIndex } = await import('./inverted-index');
      await mkdir(dirname(indexPath), { recursive: true });
      await writeFile(indexPath, serializeIndex(index, noteList.map((n) => n.id)));
    } catch (err) {
      console.warn('[Chat] Failed to persist search index:', err);
    }
  })();

  return index;
}

/** 仅供测试使用：重置缓存状态 */
export function __resetSearchCache() {
  cachedIndex = null;
  cachedAt = 0;
  loadPromise = null;
}
