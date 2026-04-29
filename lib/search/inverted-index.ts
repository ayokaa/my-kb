import type { Note } from '../types';
import type { InvertedIndexMap, Posting, SearchIndexFile } from './types';
import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict';

const jieba = Jieba.withDict(dict);

/** 索引版本号，结构变化时递增 */
export const INDEX_VERSION = 3;

/**
 * 将文本分词为检索词列表。
 * - 中文：按字切分 + 保留连续中文词
 * - 英文：按空格切分，转小写
 * - 数字：保留
 * - 标点、特殊字符去除
 */
/** 中英文停用词 */
const STOP_WORDS = new Set([
  // 中文
  '的', '是', '在', '了', '和', '与', '或', '不', '有', '我', '你', '他', '她', '它',
  '这', '那', '个', '为', '之', '也', '而', '于', '以', '及', '等', '可', '能', '会',
  '要', '就', '都', '对', '将', '还', '但', '来', '到', '上', '下', '中', '去', '过',
  // 英文
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
  'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'between', 'under', 'and', 'or', 'but', 'so', 'yet',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my',
  'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'whose',
  'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
]);

/**
 * 使用 jieba 词典分词替换纯 n-gram 膨胀。
 * jieba 输出经过停用词过滤、单字过滤、长度截断后才返回。
 */
function expandChineseTokens(segment: string): string[] {
  const tokens: string[] = [];

  for (const token of jieba.cut(segment)) {
    if (STOP_WORDS.has(token)) continue;
    // 过滤单字（区分度太低）
    if (token.length < 2) continue;
    tokens.push(token);
  }

  return tokens;
}

/**
 * 将文本分词为检索词列表。
 * - 中文：jieba 词典分词，过滤停用词和单字
 * - 英文：按空格切分，转小写
 * - 数字：保留
 * - 标点、特殊字符去除
 * - 停用词过滤
 * - 中英文混合：在边界处分割后分别处理
 */
export function tokenize(text: string): string[] {
  if (!text || typeof text !== 'string') return [];

  const tokens = new Set<string>();

  // Step 1: 在中英文/数字边界插入空格
  const segmented = text
    .replace(/([a-zA-Z0-9])([\u4e00-\u9fa5])/g, '$1 $2')
    .replace(/([\u4e00-\u9fa5])([a-zA-Z0-9])/g, '$1 $2');

  // Step 2: 按非中英文数字空格分割成原始段
  const rawSegments = segmented.split(/[^\u4e00-\u9fa5a-zA-Z0-9\s]+/).filter(Boolean);

  for (const raw of rawSegments) {
    // Step 3: 每个原始段按空白分割
    const parts = raw.split(/\s+/).filter(Boolean);

    for (const part of parts) {
      const lower = part.toLowerCase();
      if (STOP_WORDS.has(lower)) continue;

      if (/^[\u4e00-\u9fa5]+$/.test(lower)) {
        // 纯中文：展开为子词
        for (const token of expandChineseTokens(lower)) {
          tokens.add(token);
        }
      } else {
        // 英文/数字
        tokens.add(lower);
      }
    }
  }

  return Array.from(tokens);
}

/**
 * 为单个笔记构建倒排索引片段。
 */
export function buildNoteIndex(note: Note): InvertedIndexMap {
  const index: InvertedIndexMap = {};
  const entries: [string, Posting][] = [];

  // tags
  for (const tag of note.tags) {
    for (const token of tokenize(tag)) {
      entries.push([token, { noteId: note.id, field: 'tag' }]);
    }
  }

  // title
  for (const token of tokenize(note.title)) {
    entries.push([token, { noteId: note.id, field: 'title' }]);
  }

  // summary
  for (const token of tokenize(note.summary)) {
    entries.push([token, { noteId: note.id, field: 'summary' }]);
  }

  // keyFacts
  for (const fact of note.keyFacts) {
    for (const token of tokenize(fact)) {
      entries.push([token, { noteId: note.id, field: 'keyFact' }]);
    }
  }

  // qa questions
  for (const qa of note.qas) {
    for (const token of tokenize(qa.question)) {
      entries.push([token, { noteId: note.id, field: 'qa' }]);
    }
  }

  // links (target)
  for (const link of note.links) {
    for (const token of tokenize(link.target)) {
      entries.push([token, { noteId: note.id, field: 'link' }]);
    }
  }

  // backlinks (target)
  for (const link of note.backlinks || []) {
    for (const token of tokenize(link.target)) {
      entries.push([token, { noteId: note.id, field: 'backlink' }]);
    }
  }

  // content 不再索引进倒排索引（体积大、权重低）,
  // 检索时通过直接读笔记文件 + rg fallback 获取正文内容。

  // 聚合到 index
  for (const [token, posting] of entries) {
    if (!index[token]) index[token] = [];
    index[token].push(posting);
  }

  return index;
}

/**
 * 合并多个笔记的索引为一个全局索引。
 */
export function mergeIndexes(indexes: InvertedIndexMap[]): InvertedIndexMap {
  const merged: InvertedIndexMap = {};
  for (const idx of indexes) {
    for (const [token, postings] of Object.entries(idx)) {
      if (!merged[token]) merged[token] = [];
      merged[token].push(...postings);
    }
  }
  return merged;
}

/**
 * 从笔记列表构建完整倒排索引。
 */
export function buildIndex(notes: Note[]): InvertedIndexMap {
  const indexes = notes.map(buildNoteIndex);
  return mergeIndexes(indexes);
}

/**
 * 从索引中移除指定笔记的所有条目。
 */
export function removeNoteFromIndex(index: InvertedIndexMap, noteId: string): InvertedIndexMap {
  const result: InvertedIndexMap = {};
  for (const [token, postings] of Object.entries(index)) {
    const filtered = postings.filter(p => p.noteId !== noteId);
    if (filtered.length > 0) {
      result[token] = filtered;
    }
  }
  return result;
}

/**
 * 将笔记索引添加到现有索引中（用于增量更新）。
 */
export function addNoteToIndex(index: InvertedIndexMap, note: Note): InvertedIndexMap {
  const noteIndex = buildNoteIndex(note);
  return mergeIndexes([index, noteIndex]);
}

/**
 * 将索引序列化为 JSON 字符串。
 */
export function serializeIndex(index: InvertedIndexMap, noteIds: string[]): string {
  const file: SearchIndexFile = {
    version: INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    index,
    noteIds,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * 从 JSON 字符串反序列化索引。
 */
export function deserializeIndex(raw: string): SearchIndexFile | null {
  try {
    const parsed = JSON.parse(raw) as SearchIndexFile;
    if (parsed.version !== INDEX_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}
