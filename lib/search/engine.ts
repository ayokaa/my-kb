import type { Note } from '../types';
import type {
  InvertedIndexMap,
  SearchField,
  SearchOptions,
  SearchResult,
  ZoneWeights,
} from './types';
import { DEFAULT_ZONE_WEIGHTS } from './types';
import { tokenize } from './index';

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
 * - 每个查询词在笔记中只计一次分（取最高权重字段）
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

    // 取最高权重字段
    let maxWeight = 0;
    let bestField: SearchField = 'content';
    for (const p of matching) {
      const w = weights[p.field] ?? 0;
      if (w > maxWeight) {
        maxWeight = w;
        bestField = p.field;
      }
    }

    score += maxWeight;
    if (!hitFields.includes(bestField)) {
      hitFields.push(bestField);
    }
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
export function search(
  query: string,
  allNotes: Note[],
  index: InvertedIndexMap,
  options: SearchOptions = {}
): SearchResult[] {
  const {
    statusFilter = ['evergreen', 'growing'],
    limit = 5,
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
    if (score > 0) {
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
 * 根据命中字段动态裁剪内容，控制 token 预算。
 */
export function assembleContext(results: SearchResult[], maxNotes = 5): string {
  const chunks: string[] = [];

  for (const result of results.slice(0, maxNotes)) {
    const { note, hitFields, isLinkDiffusion } = result;

    if (isLinkDiffusion) {
      // 扩散笔记只取摘要
      chunks.push(
        `【相关笔记: ${note.title}】\n` +
        `摘要: ${note.summary}\n` +
        `关联原因: 被其他笔记引用\n`
      );
      continue;
    }

    // 根据命中字段决定呈现内容
    const hasQA = hitFields.includes('qa');
    const hasKeyFact = hitFields.includes('keyFact');

    if (hasQA && note.qas.length > 0) {
      // QA 命中：呈现问答对
      const qa = note.qas[0];
      chunks.push(
        `【笔记: ${note.title}】\n` +
        `相关问答:\n` +
        `Q: ${qa.question}\n` +
        `A: ${qa.answer}\n`
      );
    } else if (hasKeyFact && note.keyFacts.length > 0) {
      // KeyFact 命中：呈现摘要 + 相关事实
      const facts = note.keyFacts.slice(0, 3);
      chunks.push(
        `【笔记: ${note.title}】\n` +
        `摘要: ${note.summary}\n` +
        `相关事实:\n${facts.map(f => `- ${f}`).join('\n')}\n`
      );
    } else {
      // 默认：呈现摘要 + keyFacts + 第一个 QA
      const lines = [
        `【笔记: ${note.title}】`,
        `摘要: ${note.summary}`,
      ];
      if (note.keyFacts.length > 0) {
        lines.push(`关键事实:\n${note.keyFacts.slice(0, 3).map(f => `- ${f}`).join('\n')}`);
      }
      if (note.qas.length > 0) {
        lines.push(`常见问题:\nQ: ${note.qas[0].question}\nA: ${note.qas[0].answer}`);
      }
      chunks.push(lines.join('\n') + '\n');
    }
  }

  return chunks.join('\n---\n');
}
