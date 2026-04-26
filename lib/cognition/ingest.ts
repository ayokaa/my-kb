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

const SYSTEM_PROMPT = `你是一个个人知识库助手。请将用户提供的原始内容分析并转换成结构化的知识笔记。

要求：
1. 用中文输出所有分析内容（原始内容中的专有名词、引用、代码保持原样）
2. 提取关键概念作为标签（3-7个，不要重复）
3. 生成一句话摘要（不超过30字）
4. 分析"与我相关"的角度：为什么这条信息对我有价值
5. 提取关键事实（3-5条，每条简明扼要）
6. 如有明确时间事件，生成时间线
7. 生成1-3个常见问题及答案
8. 详细内容用 Markdown 格式重新组织，保留核心信息，去除冗余

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

export interface ProcessResult {
  note: Note;
}

export async function processInboxEntry(entry: InboxEntry): Promise<ProcessResult> {
  // For RSS or web entries, fetch original article content in background
  let content = entry.content;
  const originalUrl = (entry.rawMetadata?.rss_link || entry.rawMetadata?.source_url) as string | undefined;
  if (originalUrl) {
    try {
      const webContent = await fetchWebContent(originalUrl);
      content = webContent.content || entry.content;
    } catch (err) {
      console.warn(`[Ingest] Failed to fetch original content from ${originalUrl}:`, (err as Error).message);
      // Fallback to existing feed / stored content
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

  async function callLLM(prompt: string, retries = 1): Promise<string> {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      });
      return response.choices[0]?.message?.content?.trim() || '{}';
    } catch (err: any) {
      if (retries > 0) {
        console.warn(`[Ingest] LLM call failed, retrying... (${err.message})`);
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
    // Fallback: try to extract JSON from the response
    const match = jsonText.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  }

  // Schema validation — fail fast with a descriptive error instead of silent corruption
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM response is not a JSON object');
  }
  if (parsed.title !== undefined && typeof parsed.title !== 'string') {
    throw new Error(`LLM response field 'title' must be a string, got ${typeof parsed.title}`);
  }
  if (parsed.tags !== undefined && !Array.isArray(parsed.tags)) {
    throw new Error(`LLM response field 'tags' must be an array, got ${typeof parsed.tags}`);
  }
  if (parsed.summary !== undefined && typeof parsed.summary !== 'string') {
    throw new Error(`LLM response field 'summary' must be a string, got ${typeof parsed.summary}`);
  }
  if (parsed.personalContext !== undefined && typeof parsed.personalContext !== 'string') {
    throw new Error(`LLM response field 'personalContext' must be a string`);
  }
  if (parsed.keyFacts !== undefined && !Array.isArray(parsed.keyFacts)) {
    throw new Error(`LLM response field 'keyFacts' must be an array`);
  }
  if (parsed.timeline !== undefined && !Array.isArray(parsed.timeline)) {
    throw new Error(`LLM response field 'timeline' must be an array`);
  }
  if (parsed.links !== undefined && !Array.isArray(parsed.links)) {
    throw new Error(`LLM response field 'links' must be an array`);
  }
  if (parsed.qas !== undefined && !Array.isArray(parsed.qas)) {
    throw new Error(`LLM response field 'qas' must be an array`);
  }
  if (parsed.content !== undefined && typeof parsed.content !== 'string') {
    throw new Error(`LLM response field 'content' must be a string`);
  }

  const now = new Date().toISOString();
  const id = slugify(parsed.title || entry.title);

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
    links: Array.isArray(parsed.links)
      ? parsed.links.map((l: any) => ({
          target: String(l.target || ''),
          weight: ['strong', 'weak', 'context'].includes(l.weight) ? l.weight : 'weak',
          context: l.context ? String(l.context) : undefined,
        }))
      : [],
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
