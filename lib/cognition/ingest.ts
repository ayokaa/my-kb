import type { InboxEntry, Note, NoteLink, QAEntry, ExtractResult } from '../types';
import { fetchWebContent } from '../ingestion/web';
import { buildIndex } from '../search/inverted-index';
import { search } from '../search/engine';
import { getLLMClient, getLLMModel } from '../llm';
import { logger } from '../logger';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '');
}

// ─── Prompt Builders ──────────────────────────────────────────────

function buildExtractPrompt(): string {
  return `你是一个个人知识库助手。请分析用户提供的原始内容，提取结构化信息并重写正文。

要求：
1. 用中文输出所有分析内容（原始内容中的专有名词、引用、代码保持原样）
2. 提取关键概念作为标签（3-7个，不要重复）
3. 生成一句话摘要（不超过30字）
4. 分析"与我相关"的角度：为什么这条信息对我有价值
5. 提取关键事实（3-5条，每条简明扼要）
6. 如有明确时间事件，生成时间线
7. 详细内容用 Markdown 格式重新组织，保留核心信息，去除冗余

只输出纯 JSON，不要 markdown 代码块，不要其他解释文字。JSON 格式如下：
{
  "title": "优化后的标题",
  "tags": ["标签1", "标签2"],
  "summary": "一句话摘要",
  "personalContext": "为什么这条信息对我重要",
  "keyFacts": ["事实1", "事实2"],
  "timeline": [{"date": "2024-01", "event": "事件描述"}],
  "content": "详细 Markdown 内容"
}`;
}

function buildQAPrompt(): string {
  return `你是一个个人知识库助手。基于以下已提取的结构化笔记信息，生成 1-3 个有针对性的问答对。

要求：
1. 问题应该是对读者真正有价值的问题，不是泛泛而谈
2. 答案应该基于笔记中的具体内容，准确且有信息量
3. 优先针对关键事实和核心概念提问
4. 不要生成笔记内容中没有涉及的问题

只输出纯 JSON，不要 markdown 代码块，不要其他解释文字。JSON 格式如下：
{
  "qas": [{"question": "问题", "answer": "答案"}]
}`;
}

function buildLinkPrompt(existingTitles: string[] = []): string {
  const titleHint = existingTitles.length > 0
    ? `\n\n知识库中已有的笔记标题（links 只能关联这些真实存在的笔记，不要编造不存在的标题）：\n${existingTitles.map(t => `- ${t}`).join('\n')}`
    : '\n\n知识库目前没有笔记，links 留空即可。';

  return `你是一个个人知识库助手。基于以下已提取的结构化笔记信息，判断它与知识库中已有笔记的关联关系。

要求：
1. 只关联与当前笔记内容确实有关系的笔记（共享主题、概念互补、因果关联等）
2. 为每个关联说明具体原因
3. 设置关联权重：strong（核心主题相同）、weak（主题相关但不相同）、context（仅在特定上下文相关）
4. 如果没有真正相关的笔记，links 留空
${titleHint}

只输出纯 JSON，不要 markdown 代码块，不要其他解释文字。JSON 格式如下：
{
  "links": [{"target": "关联笔记标题", "weight": "weak", "context": "关联原因"}]
}`;
}

// ─── LLM Call with Retry ──────────────────────────────────────────

async function callLLM(systemPrompt: string, userPrompt: string, retries = 2): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const client = await getLLMClient();
      const model = await getLLMModel();
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
      });
      return response.choices[0]?.message?.content?.trim() || '{}';
    } catch (err) {
      if (attempt < retries) {
        const delay = 1000 * Math.pow(2, attempt);
        const msg = err instanceof Error ? err.message : 'Unknown error';
        logger.warn('Ingest', `LLM call failed (attempt ${attempt + 1}/${retries + 1}): ${msg}, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

// ─── Response Parsing ─────────────────────────────────────────────

function parseLLMJSON(raw: string): Record<string, unknown> {
  const jsonText = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return {};
  }
}

// ─── Validation ───────────────────────────────────────────────────

export function validateExtractOutput(parsed: unknown): asserts parsed is Record<string, unknown> {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM extract response is not a JSON object');
  }
  const p = parsed as Record<string, unknown>;

  if (p.title !== undefined && typeof p.title !== 'string') {
    throw new Error(`LLM response field 'title' must be a string, got ${typeof p.title}`);
  }
  if (p.tags !== undefined) {
    if (!Array.isArray(p.tags)) throw new Error(`LLM response field 'tags' must be an array`);
    for (const tag of p.tags) {
      if (typeof tag !== 'string') throw new Error(`LLM response field 'tags' items must be strings`);
    }
  }
  if (p.summary !== undefined && typeof p.summary !== 'string') {
    throw new Error(`LLM response field 'summary' must be a string`);
  }
  if (p.personalContext !== undefined && typeof p.personalContext !== 'string') {
    throw new Error(`LLM response field 'personalContext' must be a string`);
  }
  if (p.keyFacts !== undefined) {
    if (!Array.isArray(p.keyFacts)) throw new Error(`LLM response field 'keyFacts' must be an array`);
    for (const fact of p.keyFacts) {
      if (typeof fact !== 'string') throw new Error(`LLM response field 'keyFacts' items must be strings`);
    }
  }
  if (p.timeline !== undefined) {
    if (!Array.isArray(p.timeline)) throw new Error(`LLM response field 'timeline' must be an array`);
    for (const rawItem of p.timeline) {
      const item = rawItem as Record<string, unknown>;
      if (!item || typeof item !== 'object') throw new Error(`LLM response field 'timeline' items must be objects`);
      if (item.date !== undefined && typeof item.date !== 'string') throw new Error(`LLM response field 'timeline[].date' must be a string`);
      if (item.event !== undefined && typeof item.event !== 'string') throw new Error(`LLM response field 'timeline[].event' must be a string`);
    }
  }
  if (p.content !== undefined && typeof p.content !== 'string') {
    throw new Error(`LLM response field 'content' must be a string`);
  }
}

export function validateQAOutput(parsed: unknown): asserts parsed is Record<string, unknown> {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM QA response is not a JSON object');
  }
  const p = parsed as Record<string, unknown>;

  if (p.qas !== undefined) {
    if (!Array.isArray(p.qas)) throw new Error(`LLM response field 'qas' must be an array`);
    for (const rawItem of p.qas) {
      const item = rawItem as Record<string, unknown>;
      if (!item || typeof item !== 'object') throw new Error(`LLM response field 'qas' items must be objects`);
      if (item.question !== undefined && typeof item.question !== 'string') throw new Error(`LLM response field 'qas[].question' must be a string`);
      if (item.answer !== undefined && typeof item.answer !== 'string') throw new Error(`LLM response field 'qas[].answer' must be a string`);
    }
  }
}

export function validateLinkOutput(parsed: unknown): asserts parsed is Record<string, unknown> {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM link response is not a JSON object');
  }
  const p = parsed as Record<string, unknown>;

  if (p.links !== undefined) {
    if (!Array.isArray(p.links)) throw new Error(`LLM response field 'links' must be an array`);
    for (const rawItem of p.links) {
      const item = rawItem as Record<string, unknown>;
      if (!item || typeof item !== 'object') throw new Error(`LLM response field 'links' items must be objects`);
      if (item.target !== undefined && typeof item.target !== 'string') throw new Error(`LLM response field 'links[].target' must be a string`);
      if (item.weight !== undefined && !['strong', 'weak', 'context'].includes(item.weight as string)) {
        throw new Error(`LLM response field 'links[].weight' must be one of strong/weak/context`);
      }
      if (item.context !== undefined && typeof item.context !== 'string') throw new Error(`LLM response field 'links[].context' must be a string`);
    }
  }
}

/** 向后兼容：校验完整的 LLM 输出（所有字段） */
export function validateLLMOutput(parsed: unknown): asserts parsed is Record<string, unknown> {
  validateExtractOutput(parsed);
  const p = parsed as Record<string, unknown>;
  if (p.qas !== undefined) validateQAOutput(parsed);
  if (p.links !== undefined) validateLinkOutput(parsed);
}

// ─── Candidate Title Selection ────────────────────────────────────

const FULL_PASS_THRESHOLD = 10;
const CANDIDATE_LIMIT = 5;

interface TextSource {
  title: string;
  content: string;
}

export function selectCandidateTitles(source: TextSource, existingNotes: Note[]): string[] {
  if (existingNotes.length <= FULL_PASS_THRESHOLD) {
    return existingNotes.map((n) => n.title);
  }

  const query = `${source.title} ${source.content.slice(0, 5000)}`;
  const index = buildIndex(existingNotes);
  const results = search(query, existingNotes, index, {
    limit: CANDIDATE_LIMIT,
    enableDiffusion: false,
    statusFilter: ['seed', 'growing', 'evergreen', 'stale'],
  });

  return results.map((r) => r.note.title);
}

// ─── Pipeline Steps ───────────────────────────────────────────────

async function enrichContent(entry: InboxEntry): Promise<string> {
  let content = entry.content;
  const originalUrl = (entry.rawMetadata?.rss_link || entry.rawMetadata?.source_url) as string | undefined;
  if (originalUrl) {
    try {
      const webContent = await fetchWebContent(originalUrl);
      content = webContent.content || entry.content;
    } catch (err) {
      logger.warn('Ingest', `Failed to fetch original content from ${originalUrl}: ${(err as Error).message}`);
    }
  }
  return content;
}

async function extractStructure(entry: InboxEntry, content: string): Promise<ExtractResult> {
  const systemPrompt = buildExtractPrompt();
  const sourceInfo = [
    entry.sourceType && `来源类型: ${entry.sourceType}`,
    entry.rawMetadata?.source_url && `来源URL: ${entry.rawMetadata.source_url}`,
    entry.rawMetadata?.rss_source && `RSS源: ${entry.rawMetadata.rss_source}`,
    entry.rawMetadata?.rss_link && `RSS链接: ${entry.rawMetadata.rss_link}`,
    entry.rawMetadata?.original_filename && `原始文件: ${entry.rawMetadata.original_filename}`,
  ].filter(Boolean).join('\n');

  const userPrompt = `原始标题: ${entry.title}\n${sourceInfo}\n\n原始内容:\n${content.slice(0, 20000)}`;

  const raw = await callLLM(systemPrompt, userPrompt);
  const parsed = parseLLMJSON(raw);
  validateExtractOutput(parsed);

  return {
    title: String(parsed.title || entry.title),
    tags: Array.isArray(parsed.tags) ? Array.from(new Set(parsed.tags.map(String))) : [],
    summary: String(parsed.summary || ''),
    personalContext: String(parsed.personalContext || ''),
    keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts.map(String) : [],
    timeline: Array.isArray(parsed.timeline)
      ? parsed.timeline.map((t: any) => ({ date: String(t.date || ''), event: String(t.event || '') }))
      : [],
    content: String(parsed.content || content),
  };
}

async function generateQA(step1: ExtractResult): Promise<QAEntry[]> {
  const systemPrompt = buildQAPrompt();
  const structuredInfo = [
    `标题: ${step1.title}`,
    `标签: ${step1.tags.join(', ')}`,
    `摘要: ${step1.summary}`,
    `关键事实:\n${step1.keyFacts.map(f => `- ${f}`).join('\n')}`,
    step1.timeline.length > 0 ? `时间线:\n${step1.timeline.map(t => `- ${t.date}: ${t.event}`).join('\n')}` : '',
    `正文:\n${step1.content.slice(0, 10000)}`,
  ].filter(Boolean).join('\n\n');

  const raw = await callLLM(systemPrompt, structuredInfo);
  const parsed = parseLLMJSON(raw);
  validateQAOutput(parsed);

  return Array.isArray(parsed.qas)
    ? parsed.qas.map((q: any) => ({
        question: String(q.question || ''),
        answer: String(q.answer || ''),
      }))
    : [];
}

async function generateLinks(step1: ExtractResult, existingNotes: Note[]): Promise<NoteLink[]> {
  const candidateTitles = selectCandidateTitles(
    { title: step1.title, content: step1.content },
    existingNotes,
  );

  if (candidateTitles.length === 0) return [];

  const systemPrompt = buildLinkPrompt(candidateTitles);
  const structuredInfo = [
    `标题: ${step1.title}`,
    `标签: ${step1.tags.join(', ')}`,
    `摘要: ${step1.summary}`,
    `关键事实:\n${step1.keyFacts.map(f => `- ${f}`).join('\n')}`,
  ].join('\n\n');

  const raw = await callLLM(systemPrompt, structuredInfo);
  const parsed = parseLLMJSON(raw);
  validateLinkOutput(parsed);

  // Filter links to only point to existing notes
  const allTitles = existingNotes.map((n) => n.title);
  const normalizedTitles = new Set(allTitles.map((t) => t.toLowerCase()));
  const validLinks = Array.isArray(parsed.links)
    ? (parsed.links as any[]).filter((l: any) => {
        const target = String(l.target || '').toLowerCase();
        if (!target) return false;
        return Array.from(normalizedTitles).some(
          (t: string) => t.includes(target) || target.includes(t)
        );
      }).map((l: any) => ({
        target: String(l.target || ''),
        weight: ['strong', 'weak', 'context'].includes(l.weight) ? l.weight : 'weak',
        context: l.context ? String(l.context) : undefined,
      }))
    : [];

  if (Array.isArray(parsed.links) && parsed.links.length > validLinks.length) {
    logger.info('Ingest', `Filtered ${parsed.links.length - validLinks.length} void links, kept ${validLinks.length}`);
  }

  return validLinks;
}

// ─── Main Entry Point ─────────────────────────────────────────────

export interface ProcessResult {
  note: Note;
}

export async function processInboxEntry(entry: InboxEntry, existingNotes: Note[] = []): Promise<ProcessResult> {
  // 内容回取
  const content = await enrichContent(entry);

  // 步骤 1：提取（失败则整体失败）
  const step1 = await extractStructure(entry, content);

  // 步骤 2：生成 QA（重试耗尽后降级为空数组）
  let qas: QAEntry[] = [];
  try {
    qas = await generateQA(step1);
  } catch (err) {
    logger.warn('Ingest', `QA generation failed after retries: ${(err as Error).message}`);
  }

  // 步骤 3：生成关联（重试耗尽后降级为空数组）
  let links: NoteLink[] = [];
  try {
    links = await generateLinks(step1, existingNotes);
  } catch (err) {
    logger.warn('Ingest', `Link generation failed after retries: ${(err as Error).message}`);
  }

  // 构建 Note
  const now = new Date().toISOString();
  const originalUrl = (entry.rawMetadata?.rss_link || entry.rawMetadata?.source_url) as string | undefined;

  const note: Note = {
    id: slugify(step1.title),
    title: step1.title,
    tags: step1.tags,
    status: 'seed',
    created: now,
    updated: now,
    sources: [
      entry.sourceType,
      originalUrl,
      entry.rawMetadata?.rss_source as string,
      entry.rawMetadata?.original_filename as string,
    ].filter((s): s is string => Boolean(s)),
    summary: step1.summary,
    personalContext: step1.personalContext,
    keyFacts: step1.keyFacts,
    timeline: step1.timeline,
    links,
    backlinks: [],
    qas,
    content: step1.content,
  };

  return { note };
}
