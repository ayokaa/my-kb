import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, basename } from 'path';
import type { Note } from '../types';
import type {
  InvertedIndexMap,
  SearchField,
  SearchOptions,
  SearchResult,
  ZoneWeights,
} from './types';
import { DEFAULT_ZONE_WEIGHTS } from './types';
import { tokenize } from './inverted-index';
import { logger } from '../logger';

const execAsync = promisify(execFile);

/** 构建 link 反向映射：目标标题 → 源笔记ID列表
 * 只包含能找到对应笔记的 link（过滤虚空链接）
 */
export function buildLinkMap(notes: Note[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const allTitles = new Map(notes.map(n => [n.title.toLowerCase(), n.id]));

  for (const note of notes) {
    for (const link of note.links) {
      const target = link.target.toLowerCase();
      // 验证目标笔记是否存在（使用与 diffuseLinks 相同的匹配逻辑）
      let found = false;
      for (const [title] of allTitles) {
        if (title.includes(target) || target.includes(title)) {
          found = true;
          break;
        }
      }
      if (!found) continue;

      if (!map.has(link.target)) {
        map.set(link.target, new Set());
      }
      map.get(link.target)!.add(note.id);
    }
  }
  return map;
}

/**
 * 对单个笔记按查询词计算 Zone 加权分数。
 *
 * 规则：
 * - 每个查询词的多个字段命中分数累加（高权重字段命中多次得分更高）
 * - 加入简单 IDF：出现在越多笔记中的词，分数越低
 * - 多查询词分数累加（OR 语义）
 */
export function scoreNote(
  noteId: string,
  queryTerms: string[],
  index: InvertedIndexMap,
  weights: ZoneWeights = DEFAULT_ZONE_WEIGHTS
): { score: number; hitFields: SearchField[] } {
  let score = 0;
  const hitFields: SearchField[] = [];

  for (const term of queryTerms) {
    const postings = index[term];
    if (!postings) continue;

    const matching = postings.filter(p => p.noteId === noteId);
    if (matching.length === 0) continue;

    // 简单 IDF：该词出现在多少篇不同笔记中
    const docFreq = new Set(postings.map(p => p.noteId)).size;
    const idf = Math.max(0.3, 1 - Math.log(1 + docFreq) / 5);

    // 多个字段命中分数累加（乘以 IDF）
    let termScore = 0;
    for (const p of matching) {
      const w = weights[p.field] ?? 0;
      termScore += w * idf;
      if (!hitFields.includes(p.field)) {
        hitFields.push(p.field);
      }
    }

    score += termScore;
  }

  return { score, hitFields };
}

/**
 * 关联扩散：通过 link 关系找到与已命中笔记关联的笔记。
 *
 * - depth: 扩散深度（默认 1）
 * - decay: 权重衰减系数（默认 0.3）
 */
export function diffuseLinks(
  scoredNotes: Map<string, SearchResult>,
  allNotes: Note[],
  depth = 1,
  decay = 0.3
): Map<string, SearchResult> {
  if (depth <= 0) return scoredNotes;

  const noteMap = new Map(allNotes.map(n => [n.id, n]));
  const linkMap = buildLinkMap(allNotes);
  const additions = new Map<string, SearchResult>();

  for (const [, result] of scoredNotes) {
    for (const link of result.note.links) {
      const targetLower = link.target.toLowerCase();
      // 找到目标笔记（通过标题包含匹配），过滤虚空链接
      const targetNote = allNotes.find(
        n => n.title.toLowerCase().includes(targetLower) ||
             targetLower.includes(n.title.toLowerCase())
      );
      if (!targetNote) continue;

      // 已直接命中的笔记不需要扩散
      if (scoredNotes.has(targetNote.id)) continue;

      const diffusionScore = result.score * decay;
      const existing = additions.get(targetNote.id);
      if (!existing || diffusionScore > existing.score) {
        additions.set(targetNote.id, {
          note: targetNote,
          score: diffusionScore,
          hitFields: ['link'],
          isLinkDiffusion: true,
        });
      }
    }
  }

  // 合并
  const merged = new Map(scoredNotes);
  for (const [id, result] of additions) {
    merged.set(id, result);
  }

  // 递归扩散（如果 depth > 1）
  if (depth > 1) {
    return diffuseLinks(merged, allNotes, depth - 1, decay);
  }

  return merged;
}

/**
 * 执行搜索。
 *
 * 流程：
 * 1. Tokenize 查询
 * 2. 从倒排索引获取候选笔记（OR 语义）
 * 3. 计算 Zone 加权分数
 * 4. 关联扩散（可选）
 * 5. 排序并返回 Top N
 */
/**
 * 执行搜索。
 *
 * 流程：
 * 1. Tokenize 查询
 * 2. 从倒排索引获取候选笔记（OR 语义）
 * 3. 计算 Zone 加权分数（含 IDF）
 * 4. 关联扩散（可选）
 * 5. 按分数排序并返回 Top N
 */
export function search(
  query: string,
  allNotes: Note[],
  index: InvertedIndexMap,
  options: SearchOptions = {}
): SearchResult[] {
  const {
    statusFilter = ['evergreen', 'growing'],
    limit = 10,
    enableDiffusion = true,
    diffusionDepth = 1,
    diffusionDecay = 0.3,
  } = options;

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  // 过滤笔记状态
  const eligibleNotes = allNotes.filter(n => statusFilter.includes(n.status));
  const eligibleIds = new Set(eligibleNotes.map(n => n.id));

  // 收集候选笔记（OR 语义：至少匹配一个查询词）
  const candidateIds = new Set<string>();
  for (const term of queryTerms) {
    const postings = index[term];
    if (!postings) continue;
    for (const p of postings) {
      if (eligibleIds.has(p.noteId)) {
        candidateIds.add(p.noteId);
      }
    }
  }

  // 计算分数
  const scored = new Map<string, SearchResult>();
  for (const noteId of candidateIds) {
    const note = eligibleNotes.find(n => n.id === noteId);
    if (!note) continue;

    const { score, hitFields } = scoreNote(noteId, queryTerms, index);
    if (score > 0.5) {
      scored.set(noteId, {
        note,
        score,
        hitFields,
        isLinkDiffusion: false,
      });
    }
  }

  // 关联扩散
  if (enableDiffusion && scored.size > 0) {
    const diffused = diffuseLinks(scored, eligibleNotes, diffusionDepth, diffusionDecay);
    scored.clear();
    for (const [id, r] of diffused) scored.set(id, r);
  }

  // 排序，如设置了 limit 则截取
  const results = Array.from(scored.values())
    .sort((a, b) => b.score - a.score);

  if (limit !== undefined && limit > 0) {
    return results.slice(0, limit);
  }
  return results;
}

/**
 * 组装检索结果为人类可读的上下文字符串。
 *
 * 使用字符预算机制：按相关度从高到低依次包含笔记内容，
 * 尽可能多地放入上下文，而不是硬截断到固定篇数。
 */
export function assembleContext(
  results: SearchResult[],
  options: { maxChars?: number; contentChars?: number } = {}
): string {
  const { maxChars = 15000, contentChars = 2000 } = options;
  const chunks: string[] = [];
  let usedChars = 0;
  let includedCount = 0;

  for (const result of results) {
    const { note, isLinkDiffusion } = result;

    let chunk: string;
    if (isLinkDiffusion) {
      chunk =
        `【相关笔记: ${note.title}】(ID: ${note.id})\n` +
        `摘要: ${note.summary}\n` +
        `关联原因: 被其他笔记引用\n`;
    } else {
      const lines = [
        `【笔记: ${note.title}】(ID: ${note.id})`,
        `标签: ${note.tags.join(', ')}`,
        `来源: ${note.sources.join(', ')}`,
        `摘要: ${note.summary}`,
      ];

      if (note.keyFacts.length > 0) {
        lines.push(`关键事实:\n${note.keyFacts.map(f => `- ${f}`).join('\n')}`);
      }

      if (note.qas.length > 0) {
        const qaLines = note.qas.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join('\n');
        lines.push(`问答:\n${qaLines}`);
      }

      const contentPreview = note.content.slice(0, contentChars);
      if (contentPreview.length > 0) {
        lines.push(
          `正文:\n${contentPreview}${note.content.length > contentChars ? '...' : ''}`
        );
      }

      chunk = lines.join('\n') + '\n';
    }

    // 预算检查：如果加上这篇会超预算，跳过（但至少要包含一篇）
    if (usedChars + chunk.length > maxChars && includedCount > 0) {
      break;
    }

    chunks.push(chunk);
    usedChars += chunk.length;
    includedCount++;
  }

  // 如果还有未展示的笔记，告知 LLM
  const remaining = results.length - includedCount;
  if (remaining > 0) {
    chunks.push(
      `【提示】知识库中还有 ${remaining} 篇相关笔记因上下文长度限制未展示。`
    );
  }

  return chunks.join('\n---\n');
}

/**
 * 使用 ripgrep 对 notes/ 目录做全文兜底搜索。
 *
 * 当结构化的倒排索引返回结果太少时（只有 title/tags/summary 等字段，不含 content），
 * 用 rg 扫描正文内容作为补充。
 *
 * @returns 匹配的笔记 ID 列表（排除了 excludeIds 中的已有结果）
 */
export async function contentFallback(
  query: string,
  knowledgeRoot: string,
  excludeIds: Set<string>
): Promise<string[]> {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  // 转义正则特殊字符，拼接为 OR 模式
  const pattern = queryTerms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  const notesDir = join(knowledgeRoot, 'notes');

  try {
    const { stdout } = await execAsync('rg', [
      '-l', // 只输出文件名
      '-i', // 忽略大小写
      pattern,
      notesDir,
    ], { timeout: 3000 });

    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((f) => basename(f, '.md'))
      .filter((id) => !excludeIds.has(id));
  } catch (err: any) {
    // rg exit code 1 = 没有匹配（正常情况）
    if (err.code === 1) return [];
    // 其他错误（rg 未安装、超时等）
    if (err.code !== 'ENOENT') {
      logger.warn('search', 'rg fallback failed', { error: err });
    }
    return [];
  }
}
