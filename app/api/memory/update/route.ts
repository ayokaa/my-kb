import Anthropic from '@anthropic-ai/sdk';
import { getLLMClient, getLLMModel } from '@/lib/llm';
import { loadMemory, saveMemory, mergeMemory, evolveNoteStatuses, type MemoryExtractResult } from '@/lib/memory';
import { logger } from '@/lib/logger';

const MEMORY_SYSTEM_PROMPT = `你是一个用户建模助手。分析用户和 AI 助手的一次完整会话，提取以下信息。只基于对话内容，不要编造。

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
      "noteId": "笔记 ID（对话中笔记标注的 ID: xxx 值，如 rag-overview）",
      "level": "referenced 或 discussed",
      "notes": "用户对该笔记话题的认知水平观察（1句话）"
    }
  ],
  "conversationDigest": "最近会话的整体摘要（2-3句话，涵盖本次及近期对话的核心主题）",
  "preferenceSignals": {
    "_description": "以下为示例，键名不限于这些。任何从对话中观察到的用户偏好都可以记录",
    "detailLevel": "concise 或 normal 或 detailed（如果观察到）",
    "preferCodeExamples": true,
    "language": "用户偏好的语言（如 zh, en 等）",
    "responseFormat": "用户偏好的回答格式（如 markdown, 列表, 表格）",
    "expertiseLevel": "用户表现出的专业水平（beginner, intermediate, expert）"
  }
}

规则：
- 只填有变化的字段，没观察到的字段不填或省略
- 不要重复已有信息，只提取新内容
- noteFamiliarity 只在对话确实涉及某篇笔记时才填
- conversationDigest 用中文`;

async function processMemoryUpdate(convId: string, messages: Array<{ role: string; content: string }>) {
  try {
    const existingMemory = await loadMemory();

    // 构建用户消息
    const profileSummary = [
      existingMemory.profile.role && `角色: ${existingMemory.profile.role}`,
      existingMemory.profile.techStack.length > 0 && `技术栈: ${existingMemory.profile.techStack.join(', ')}`,
      existingMemory.profile.interests.length > 0 && `兴趣: ${existingMemory.profile.interests.join(', ')}`,
      existingMemory.profile.background && `补充: ${existingMemory.profile.background}`,
    ].filter(Boolean).join('\n');

    const recentTopics = existingMemory.conversationDigest;

    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n');

    const userPrompt = [
      '【当前用户档案】',
      profileSummary || '(尚无档案)',
      '',
      recentTopics ? `最近话题：${recentTopics}` : '',
      '',
      '【本次会话】',
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
      return;
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
  } catch (err) {
    logger.error('Memory', `Update failed: ${(err as Error).message}`);
  }
}

export async function POST(req: Request) {
  let body: { conversationId?: unknown; messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { conversationId, messages } = body;
  if (!Array.isArray(messages) || messages.length < 2) {
    logger.info('Memory', `Update request rejected: not enough messages (got ${Array.isArray(messages) ? messages.length : 'none'})`);
    return Response.json({ ok: false, reason: 'not enough messages' });
  }

  const convId = typeof conversationId === 'string' ? conversationId : 'unknown';
  logger.info('Memory', `Received update request for conversation=${convId}, messages=${messages.length}`);

  // 立即返回，后台异步执行 LLM 分析，避免阻塞 HTTP 连接
  queueMicrotask(() => {
    processMemoryUpdate(convId, messages as Array<{ role: string; content: string }>).catch(() => {});
  });

  return Response.json({ ok: true, queued: true });
}
