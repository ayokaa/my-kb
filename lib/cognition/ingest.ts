import OpenAI from 'openai';
import type { InboxEntry, Note, NoteLink, TimelineEntry, QAEntry } from '../types';
import { fetchWebContent } from '../ingestion/web';

const client = new OpenAI({
  apiKey: process.env.MINIMAX_API_KEY || '',
  baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
});

const MODEL = 'MiniMax-M2.7';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '');
}

function buildSystemPrompt(existingTitles: string[] = []): string {
  const titleHint = existingTitles.length > 0
    ? `\n\n知识库中已有的笔记标题（links 只能关联这些真实存在的笔记，不要编造不存在的标题）：\n${existingTitles.map(t => `- ${t}`).join('\n')}`
    : '\n\n知识库目前没有笔记，links 留空即可。';

  return `你是一个个人知识库助手。请将用户提供的原始内容分析并转换成结构化的知识笔记。

要求：
1. 用中文输出所有分析内容（原始内容中的专有名词、引用、代码保持原样）
2. 提取关键概念作为标签（3-7个，不要重复）
3. 生成一句话摘要（不超过30字）
4. 分析"与我相关"的角度：为什么这条信息对我有价值
5. 提取关键事实（3-5条，每条简明扼要）
6. 如有明确时间事件，生成时间线
7. 生成1-3个常见问题及答案
8. 详细内容用 Markdown 格式重新组织，保留核心信息，去除冗余
9. links 只关联知识库中真实存在的笔记，target 必须与已有笔记标题完全匹配或高度相似${titleHint}

只输出纯 JSON，不要 markdown 代码块，不要其他解释文字。JSON 格式如下：
{
  "title": "优化后的标题",
  "tags": ["标签1", "标签2"],
  "summary": "一句话摘要",
  "personalContext": "为什么这条信息对我重要",
  "keyFacts": ["事实1", "事实2"],
  "timeline": [{"date": "2024-01", "event": "事件描述"}],
  "qas": [{"question": "问题", "answer": "答案"}],
  "links": [{"target": "关联笔记标题", "weight": "weak", "context": "关联原因"}],
  "content": "详细 Markdown 内容"
}`;
}

export interface ProcessResult {
  note: Note;
}

export function validateLLMOutput(parsed: unknown): asserts parsed is Record<string, unknown> {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM response is not a JSON object');
  }
  const p = parsed as Record<string, unknown>;

  if (p.title !== undefined && typeof p.title !== 'string') {
    throw new Error(`LLM response field 'title' must be a string, got ${typeof p.title}`);
  }
  if (p.tags !== undefined) {
    if (!Array.isArray(p.tags)) {
      throw new Error(`LLM response field 'tags' must be an array, got ${typeof p.tags}`);
    }
    for (const tag of p.tags) {
      if (typeof tag !== 'string') {
        throw new Error(`LLM response field 'tags' items must be strings, got ${typeof tag}`);
      }
    }
  }
  if (p.summary !== undefined && typeof p.summary !== 'string') {
    throw new Error(`LLM response field 'summary' must be a string, got ${typeof p.summary}`);
  }
  if (p.personalContext !== undefined && typeof p.personalContext !== 'string') {
    throw new Error(`LLM response field 'personalContext' must be a string`);
  }
  if (p.keyFacts !== undefined) {
    if (!Array.isArray(p.keyFacts)) {
      throw new Error(`LLM response field 'keyFacts' must be an array`);
    }
    for (const fact of p.keyFacts) {
      if (typeof fact !== 'string') {
        throw new Error(`LLM response field 'keyFacts' items must be strings, got ${typeof fact}`);
      }
    }
  }
  if (p.timeline !== undefined) {
    if (!Array.isArray(p.timeline)) {
      throw new Error(`LLM response field 'timeline' must be an array`);
    }
    for (const rawItem of p.timeline) {
      const item = rawItem as Record<string, unknown>;
      if (!item || typeof item !== 'object') {
        throw new Error(`LLM response field 'timeline' items must be objects`);
      }
      if (item.date !== undefined && typeof item.date !== 'string') {
        throw new Error(`LLM response field 'timeline[].date' must be a string`);
      }
      if (item.event !== undefined && typeof item.event !== 'string') {
        throw new Error(`LLM response field 'timeline[].event' must be a string`);
      }
    }
  }
  if (p.links !== undefined) {
    if (!Array.isArray(p.links)) {
      throw new Error(`LLM response field 'links' must be an array`);
    }
    for (const rawItem of p.links) {
      const item = rawItem as Record<string, unknown>;
      if (!item || typeof item !== 'object') {
        throw new Error(`LLM response field 'links' items must be objects`);
      }
      if (item.target !== undefined && typeof item.target !== 'string') {
        throw new Error(`LLM response field 'links[].target' must be a string`);
      }
      if (item.weight !== undefined && !['strong', 'weak', 'context'].includes(item.weight as string)) {
        throw new Error(`LLM response field 'links[].weight' must be one of strong/weak/context`);
      }
      if (item.context !== undefined && typeof item.context !== 'string') {
        throw new Error(`LLM response field 'links[].context' must be a string`);
      }
    }
  }
  if (p.qas !== undefined) {
    if (!Array.isArray(p.qas)) {
      throw new Error(`LLM response field 'qas' must be an array`);
    }
    for (const rawItem of p.qas) {
      const item = rawItem as Record<string, unknown>;
      if (!item || typeof item !== 'object') {
        throw new Error(`LLM response field 'qas' items must be objects`);
      }
      if (item.question !== undefined && typeof item.question !== 'string') {
        throw new Error(`LLM response field 'qas[].question' must be a string`);
      }
      if (item.answer !== undefined && typeof item.answer !== 'string') {
        throw new Error(`LLM response field 'qas[].answer' must be a string`);
      }
    }
  }
  if (p.content !== undefined && typeof p.content !== 'string') {
    throw new Error(`LLM response field 'content' must be a string`);
  }
}

export async function processInboxEntry(entry: InboxEntry, existingTitles: string[] = []): Promise<ProcessResult> {
  // For RSS or web entries, fetch original article content in background
  let content = entry.content;
  const originalUrl = (entry.rawMetadata?.rss_link || entry.rawMetadata?.source_url) as string | undefined;
  if (originalUrl) {
    try {
      const webContent = await fetchWebContent(originalUrl);
      content = webContent.content || entry.content;
    } catch (err) {
      console.warn(`[Ingest] Failed to fetch original content from ${originalUrl}:`, (err as Error).message);
    }
  }

  const sourceInfo = [
    entry.sourceType && `来源类型: ${entry.sourceType}`,
    entry.rawMetadata?.source_url && `来源URL: ${entry.rawMetadata.source_url}`,
    entry.rawMetadata?.rss_source && `RSS源: ${entry.rawMetadata.rss_source}`,
    entry.rawMetadata?.rss_link && `RSS链接: ${entry.rawMetadata.rss_link}`,
    entry.rawMetadata?.original_filename && `原始文件: ${entry.rawMetadata.original_filename}`,
  ].filter(Boolean).join('\n');

  const userPrompt = `原始标题: ${entry.title}\n${sourceInfo}\n\n原始内容:\n${content.slice(0, 20000)}`;
  const systemPrompt = buildSystemPrompt(existingTitles);

  async function callLLM(prompt: string, retries = 1): Promise<string> {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      });
      return response.choices[0]?.message?.content?.trim() || '{}';
    } catch (err) {
      if (retries > 0) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.warn(`[Ingest] LLM call failed, retrying... (${msg})`);
        await new Promise((r) => setTimeout(r, 2000));
        return callLLM(prompt, retries - 1);
      }
      throw err;
    }
  }

  const raw = await callLLM(userPrompt);
  const jsonText = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  }

  validateLLMOutput(parsed);

  const now = new Date().toISOString();
  const id = slugify(parsed.title || entry.title);

  // Filter links to only point to existing notes
  const normalizedTitles = new Set(existingTitles.map(t => t.toLowerCase()));
  const validLinks = Array.isArray(parsed.links)
    ? parsed.links.filter((l: any) => {
        const target = String(l.target || '').toLowerCase();
        if (!target) return false;
        // Allow exact match or one contains the other (same logic as diffuseLinks)
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
    console.log(`[Ingest] Filtered ${parsed.links.length - validLinks.length} void links, kept ${validLinks.length}`);
  }

  const note: Note = {
    id,
    title: parsed.title || entry.title,
    tags: Array.isArray(parsed.tags) ? Array.from(new Set(parsed.tags.map(String))) : [],
    status: 'seed',
    created: now,
    updated: now,
    sources: [
      entry.sourceType,
      originalUrl,
      entry.rawMetadata?.rss_source as string,
      entry.rawMetadata?.original_filename as string,
    ].filter((s): s is string => Boolean(s)),
    summary: parsed.summary || '',
    personalContext: parsed.personalContext || '',
    keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts.map(String) : [],
    timeline: Array.isArray(parsed.timeline)
      ? parsed.timeline.map((t: any) => ({ date: String(t.date || ''), event: String(t.event || '') }))
      : [],
    links: validLinks,
    qas: Array.isArray(parsed.qas)
      ? parsed.qas.map((q: any) => ({
          question: String(q.question || ''),
          answer: String(q.answer || ''),
        }))
      : [],
    content: parsed.content || entry.content,
  };

  return { note };
}
