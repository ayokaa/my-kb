import type { Note, NoteLink } from '../types';
import { selectCandidates } from './ingest';
import Anthropic from '@anthropic-ai/sdk';
import { getLLMClient, getLLMModel } from '../llm';
import { logger } from '../logger';

function buildRelinkPrompt(candidates: Note[] = []): string {
  const candidateHint = candidates.length > 0
    ? `\n\n知识库中可能相关的笔记（links 只能关联这些真实存在的笔记，不要编造不存在的标题）：\n${candidates.map(n => {
      const facts = n.keyFacts.length > 0 ? `\n关键事实：\n${n.keyFacts.map(f => `  - ${f}`).join('\n')}` : '';
      return `【${n.title}】\n摘要：${n.summary}${facts}`;
    }).join('\n\n')}`
    : '\n\n知识库目前没有相关笔记，links 留空即可。';

  return `你是一个个人知识库助手。请基于当前笔记的完整内容，重新判断它应该与知识库中的哪些笔记建立关联。

要求：
1. links 只关联下面列出的真实存在的笔记，不要编造
2. 每个 link 包含 target（目标笔记标题）、weight（strong/weak/context）、context（关联原因，一句话）
3. 如果当前笔记与候选笔记没有实质性关联，links 留空
4. 请输出完整的关联列表，不是增量补充；之前存在的关联如果仍然有效请保留，无效的请移除
5. 最多关联 5 个笔记，优先保留关联度最高的
6. 只输出纯 JSON，不要 markdown 代码块，不要其他解释文字

JSON 格式如下：
{
  "links": [{"target": "关联笔记标题", "weight": "weak", "context": "关联原因"}]
}${candidateHint}`;
}

export async function relinkNote(note: Note, allNotes: Note[]): Promise<NoteLink[]> {
  const otherNotes = allNotes.filter((n) => n.id !== note.id);
  if (otherNotes.length === 0) return note.links;

  const candidates = selectCandidates(
    { title: note.title, content: note.content },
    otherNotes
  );

  if (candidates.length === 0) return note.links;

  const systemPrompt = buildRelinkPrompt(candidates);
  const userPrompt = `当前笔记标题: ${note.title}\n标签: ${note.tags.join(', ')}\n摘要: ${note.summary}\n关键事实: ${note.keyFacts.join('; ')}\n内容:\n${note.content.slice(0, 8000)}`;

  async function callLLM(retries = 1): Promise<string> {
    try {
      const client = await getLLMClient();
      const model = await getLLMModel();
      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.3,
      });
      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
      return textBlocks.map((b) => b.text).join('').trim() || '{}';
    } catch (err) {
      if (retries > 0) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        logger.warn('Relink', `LLM call failed, retrying... (${msg})`);
        await new Promise((r) => setTimeout(r, 2000));
        return callLLM(retries - 1);
      }
      throw err;
    }
  }

  const raw = await callLLM();
  const jsonText = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  }

  const allTitles = new Set(allNotes.map((n) => n.title.toLowerCase()));
  const newLinks: NoteLink[] = Array.isArray(parsed.links)
    ? parsed.links
        .filter((l: any) => {
          const target = String(l.target || '').toLowerCase();
          if (!target) return false;
          // Allow exact match or one contains the other
          return Array.from(allTitles).some(
            (t: string) => t.includes(target) || target.includes(t)
          );
        })
        .map((l: any) => ({
          target: String(l.target || ''),
          weight: ['strong', 'weak', 'context'].includes(l.weight) ? l.weight : 'weak',
          context: l.context ? String(l.context) : undefined,
        }))
    : [];

  if (newLinks.length > 0) {
    logger.info('Relink', `${note.title}: ${newLinks.length} new link(s) suggested`);
  }

  return newLinks.slice(0, 5);
}

export interface RelinkResult {
  processed: number;
  updated: number;
  failed: number;
}

export async function runRelinkJob(
  listNotes: () => Promise<Note[]>,
  saveNote: (note: Note) => Promise<void>
): Promise<RelinkResult> {
  const allNotes = await listNotes();
  if (allNotes.length === 0) {
    return { processed: 0, updated: 0, failed: 0 };
  }

  let updated = 0;
  let failed = 0;

  for (const note of allNotes) {
    try {
      const newLinks = await relinkNote(note, allNotes);
      if (newLinks.length !== note.links.length ||
          !linksEqual(newLinks, note.links)) {
        note.links = newLinks;
        note.updated = new Date().toISOString();
        await saveNote(note);
        updated++;
      }
    } catch (err) {
      failed++;
      logger.error('Relink', `Failed to relink "${note.title}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

    logger.info('Relink', `Job complete: ${allNotes.length} processed, ${updated} updated, ${failed} failed`);
  return { processed: allNotes.length, updated, failed };
}

function linksEqual(a: NoteLink[], b: NoteLink[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x.target.localeCompare(y.target));
  const sortedB = [...b].sort((x, y) => x.target.localeCompare(y.target));
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i].target !== sortedB[i].target) return false;
    if (sortedA[i].weight !== sortedB[i].weight) return false;
    if (sortedA[i].context !== sortedB[i].context) return false;
  }
  return true;
}
