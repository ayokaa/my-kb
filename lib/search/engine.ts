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

/** 构建 link 反向映射：目标标题 → 源笔记ID列表 */
export function buildLinkMap(notes: Note[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const note of notes) {
    for (const link of note.links) {
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
      // 找到目标笔记（通过标题包含匹配）
      const targetNote = allNotes.find(
        n => n.title.toLowerCase().includes(link.target.toLowerCase()) ||
             link.target.toLowerCase().includes(n.title.toLowerCase())
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

  // 排序并截取
  const results = Array.from(scored.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

/**
 * 组装检索结果为人类可读的上下文字符串。
 *
 * 包含笔记的完整元数据 + 正文前 800 字，让 LLM 能看到更完整的内容。
 */
export function assembleContext(results: SearchResult[], maxNotes = 10): string {
  const chunks: string[] = [];

  for (const result of results.slice(0, maxNotes)) {
    const { note, isLinkDiffusion } = result;

    if (isLinkDiffusion) {
      chunks.push(
        `【相关笔记: ${note.title}】\n` +
        `摘要: ${note.summary}\n` +
        `关联原因: 被其他笔记引用\n`
      );
      continue;
    }

    const lines = [
      `【笔记: ${note.title}】`,
      `标签: ${note.tags.join(', ')}`,
      `摘要: ${note.summary}`,
    ];

    if (note.keyFacts.length > 0) {
      lines.push(`关键事实:\n${note.keyFacts.map(f => `- ${f}`).join('\n')}`);
    }

    if (note.qas.length > 0) {
      const qaLines = note.qas.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join('\n');
      lines.push(`问答:\n${qaLines}`);
    }

    // 加入正文前 800 字符（让 LLM 能看到更多内容）
    const contentPreview = note.content.slice(0, 800);
    if (contentPreview.length > 0) {
      lines.push(`正文:\n${contentPreview}${note.content.length > 800 ? '...' : ''}`);
    }

    chunks.push(lines.join('\n') + '\n');
  }

  return chunks.join('\n---\n');
}
