import Anthropic from '@anthropic-ai/sdk';
import { getLLMClient, getLLMModel } from '@/lib/llm';
import { loadMemory, saveMemory, mergeMemory, evolveNoteStatuses, type MemoryExtractResult } from '@/lib/memory';
import { logger } from '@/lib/logger';

const MEMORY_SYSTEM_PROMPT = `你是一个用户建模助手。分析用户和 AI 助手的对话，提取以下信息。只基于对话内容，不要编造。

输出严格 JSON，不要 markdown 代码块：

{
  "profileChanges": {
    "role": "用户的职业角色（如有新信息，不填则省略此字段）",
    "techStack": ["技术栈新增项（不填则省略此字段）"],
    "interests": ["新发现的兴趣领域（不填则省略此字段）"],
    "background": "补充的背景信息（如有，不填则省略此字段）"
  },
  "noteFamiliarity": [
    {
      "noteId": "笔记 ID",
      "level": "referenced 或 discussed",
      "notes": "用户对该笔记话题的认知水平观察（1句话）"
    }
  ],
  "conversationDigest": {
    "summary": "本轮对话的核心主题（1-2句话）",
    "topics": ["3-5个话题关键词"]
  },
  "preferenceSignals": {
    "detailLevel": "concise 或 normal 或 detailed（如果观察到）",
    "preferCodeExamples": true
  }
}

规则：
- 只填有变化的字段，没观察到的字段不填或省略
- 不要重复已有信息，只提取新内容
- noteFamiliarity 只在对话确实涉及某篇笔记时才填
- conversationDigest.summary 用中文`;

export async function POST(req: Request) {
  let body: { conversationId?: unknown; messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { conversationId, messages } = body;
  if (!Array.isArray(messages) || messages.length < 2) {
    return Response.json({ ok: false, reason: 'not enough messages' });
  }

  const convId = typeof conversationId === 'string' ? conversationId : 'unknown';

  try {
    const existingMemory = await loadMemory();

    // 构建用户消息
    const profileSummary = [
      existingMemory.profile.role && `角色: ${existingMemory.profile.role}`,
      existingMemory.profile.techStack.length > 0 && `技术栈: ${existingMemory.profile.techStack.join(', ')}`,
      existingMemory.profile.interests.length > 0 && `兴趣: ${existingMemory.profile.interests.join(', ')}`,
      existingMemory.profile.background && `补充: ${existingMemory.profile.background}`,
    ].filter(Boolean).join('\n');

    const recentTopics = existingMemory.conversationDigest
      .slice(0, 3)
      .map((d) => d.summary)
      .join('; ');

    const conversationText = (messages as Array<{ role: string; content: string }>)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n');

    const userPrompt = [
      '【当前用户档案】',
      profileSummary || '(尚无档案)',
      '',
      recentTopics ? `最近话题：${recentTopics}` : '',
      '',
      '【本轮对话】',
      conversationText.slice(0, 8000),
    ].join('\n');

    // LLM 调用
    const client = await getLLMClient();
    const model = await getLLMModel();
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      temperature: 0.3,
      system: MEMORY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    const raw = textBlocks.map((b) => b.text).join('').trim();

    // 解析 LLM 输出
    let extracted: MemoryExtractResult;
    try {
      const jsonText = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      extracted = JSON.parse(jsonText);
    } catch (parseErr) {
      logger.warn('Memory', `Failed to parse LLM output: ${(parseErr as Error).message}`);
      return Response.json({ ok: false, reason: 'parse error' });
    }

    // 合并并保存
    const updated = mergeMemory(existingMemory, extracted, convId);
    await saveMemory(updated);

    // 根据新的 noteKnowledge 自动演进笔记状态
    const statusChanges = await evolveNoteStatuses(updated);
    if (statusChanges.length > 0) {
      logger.info('Memory', `Status changes: ${statusChanges.map(c => `${c.noteId}: ${c.from}→${c.to}`).join(', ')}`);
    }

    logger.info('Memory', `Updated for conversation ${convId}`);
    return Response.json({ ok: true });
  } catch (err) {
    logger.error('Memory', `Update failed: ${(err as Error).message}`);
    return Response.json({ ok: false, reason: 'internal error' });
  }
}
