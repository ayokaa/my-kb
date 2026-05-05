import Anthropic from '@anthropic-ai/sdk';
import { getLLMClient, getLLMModel } from '@/lib/llm';
import { loadMemory, saveMemory, mergeMemory, evolveNoteStatuses, type MemoryExtractResult } from '@/lib/memory';
import { logger } from '@/lib/logger';
import { loadSettings } from '@/lib/settings';

// ── 各任务独立的 System Prompt ─────────────────────────────

const PROFILE_SYSTEM_PROMPT = `你是一个用户画像提取助手。分析用户和 AI 的对话，只提取用户**明确陈述**的画像信息。

输出严格 JSON，不要 markdown：
{
  "role": "用户明确陈述的职业身份（没有则省略）",
  "interests": ["用户明确表达的长期关注领域（临时好奇不要填）"],
  "background": "用户明确陈述的补充背景（没有则省略）"
}

【边界示例】
✅ user: "我是前端开发者" → { "role": "前端开发者" }
❌ user: "Rust 和 Go 哪个好？" → {} （临时询问）
❌ user: "AI 绘画很火" → {} （随口提及）

没有变化时返回 {} 或只输出空 JSON。`;

const NOTE_FAMILIARITY_SYSTEM_PROMPT = `你是一个笔记认知评估助手。分析对话中涉及的知识库笔记，评估用户对这些笔记的认知水平。

对话中笔记会以 "ID: xxx" 的形式标注。输出严格 JSON：
{
  "noteFamiliarity": [
    {
      "noteId": "笔记 ID",
      "level": "referenced | discussed",
      "notes": "用户对该笔记的认知水平观察（1句话）"
    }
  ]
}

对话未涉及任何笔记时返回 {}。`;

const DIGEST_SYSTEM_PROMPT = `你是一个会话摘要助手。分析本次对话，生成 1-2 句核心摘要。

输出严格 JSON：
{
  "newDigest": "本轮对话的 1-2 句核心摘要，提炼用户本次最关心的主题和意图"
}

只关注本轮对话本身，不需要关联历史。`;

const PREFERENCE_SYSTEM_PROMPT = `你是一个用户偏好识别助手。分析对话，提取用户**明确表达**的偏好。

输出严格 JSON：
{
  "preferenceSignals": {
    "detailLevel": "concise | normal | detailed（仅当用户明确说时）",
    "preferCodeExamples": true,
    "language": "用户明确偏好的语言",
    "responseFormat": "用户明确要求的格式",
    "expertiseLevel": "用户明确表现出的水平"
  }
}

不要猜测。没有明确偏好时返回 {}。`;

const DISCUSSION_REGEN_SYSTEM_PROMPT = `你是一个用户动态综合助手。基于用户最近的多轮会话摘要，生成一段综合的"最近讨论"文本。

输入是多条按时间排列的会话摘要，你需要：
1. 识别用户持续关注的主线主题
2. 发现新的关注方向或变化
3. 概括用户最近在做什么、关注什么

输出严格 JSON：
{
  "recentDiscussion": "3-5 句综合文本，像一段自然的用户动态摘要"
}

要求：
- 基于所有历史摘要综合，不要只写最新一条
- 语言自然流畅，不是 bullet list
- 中文`;

// ── 通用 LLM 调用工具 ──────────────────────────────────────

async function callLLM(system: string, userContent: string, maxTokens = 1024): Promise<unknown> {
  const client = await getLLMClient();
  const model = await getLLMModel();
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature: 0.3,
    system,
    messages: [{ role: 'user', content: userContent }],
  });

  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === 'text'
  );
  const raw = textBlocks.map((b) => b.text).join('').trim();

  const jsonText = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  return JSON.parse(jsonText);
}

async function safeCallLLM(
  taskName: string,
  system: string,
  userContent: string,
  maxTokens = 1024
): Promise<unknown | null> {
  try {
    return await callLLM(system, userContent, maxTokens);
  } catch (err) {
    logger.warn('Memory', `${taskName} failed: ${(err as Error).message}`);
    return null;
  }
}

// ── 延迟重新生成 "最近讨论" 的 debounce 机制 ───────────────

let discussionRegenTimer: NodeJS.Timeout | null = null;
const DISCUSSION_REGEN_DELAY_MS = 10 * 60 * 1000; // 10 分钟

async function regenerateRecentDiscussion() {
  try {
    logger.info('Memory', 'Starting delayed discussion regeneration');
    const memory = await loadMemory();
    if (memory.recentDigests.length === 0) {
      logger.info('Memory', 'Skipping regen: no recent digests');
      return;
    }

    const digestsText = memory.recentDigests.join('\n');
    const userPrompt = [
      '【最近会话摘要】（从新到旧）',
      digestsText,
      '',
      '【任务】基于以上全部摘要，生成一段综合的"最近讨论"文本。',
    ].join('\n');

    const result = await safeCallLLM(
      'regenerateDiscussion',
      DISCUSSION_REGEN_SYSTEM_PROMPT,
      userPrompt,
      1536
    );

    if (result && (result as Record<string, unknown>).recentDiscussion) {
      const recentDiscussion = (result as Record<string, unknown>).recentDiscussion as string;
      memory.conversationDigest = recentDiscussion;
      await saveMemory(memory);
      logger.info('Memory', `Regenerated recentDiscussion (${memory.recentDigests.length} digests)`);
    } else {
      logger.warn('Memory', 'Regen produced no recentDiscussion');
    }
  } catch (err) {
    logger.error('Memory', `Discussion regen failed: ${(err as Error).message}`);
  }
}

function scheduleDiscussionRegen() {
  if (discussionRegenTimer) {
    logger.info('Memory', `Cancelling previous regen timer, rescheduling in ${DISCUSSION_REGEN_DELAY_MS / 60000}min`);
    clearTimeout(discussionRegenTimer);
  } else {
    logger.info('Memory', `Scheduling regen in ${DISCUSSION_REGEN_DELAY_MS / 60000}min`);
  }
  discussionRegenTimer = setTimeout(() => {
    regenerateRecentDiscussion().catch(() => {});
    discussionRegenTimer = null;
  }, DISCUSSION_REGEN_DELAY_MS);
}

// ── 各即时任务的 user prompt 构建 ──────────────────────────

function buildUserContext(existingMemory: Awaited<ReturnType<typeof loadMemory>>): string {
  const parts: string[] = [];

  const profileLines = [
    existingMemory.profile.role && `角色: ${existingMemory.profile.role}`,
    existingMemory.profile.interests.length > 0 && `兴趣: ${existingMemory.profile.interests.join(', ')}`,
    existingMemory.profile.background && `背景: ${existingMemory.profile.background}`,
  ].filter(Boolean);
  if (profileLines.length > 0) {
    parts.push('【用户画像】');
    parts.push(...profileLines);
  }

  const prefLines = Object.entries(existingMemory.preferences)
    .map(([k, v]) => `- ${k}: ${v}`);
  if (prefLines.length > 0) {
    parts.push('【已知偏好】');
    parts.push(...prefLines);
  }

  return parts.join('\n') || '(尚无用户记忆)';
}

function buildProfilePrompt(existingMemory: Awaited<ReturnType<typeof loadMemory>>, conversationText: string): string {
  return [
    buildUserContext(existingMemory),
    '',
    '【本次对话】',
    conversationText.slice(0, 4000),
    '',
    '【任务】只提取用户明确陈述的画像变化（角色/兴趣/背景），不要推断。',
  ].join('\n');
}

function buildNoteFamiliarityPrompt(
  existingMemory: Awaited<ReturnType<typeof loadMemory>>,
  conversationText: string
): string {
  return [
    buildUserContext(existingMemory),
    '',
    '【本次对话】',
    conversationText.slice(0, 4000),
    '',
    '【任务】基于用户画像和本次对话，更新涉及的笔记认知评估。未涉及的笔记不要输出。',
  ].join('\n');
}

function buildDigestPrompt(
  existingMemory: Awaited<ReturnType<typeof loadMemory>>,
  conversationText: string
): string {
  return [
    buildUserContext(existingMemory),
    '',
    '【本次对话】',
    conversationText.slice(0, 6000),
    '',
    '【任务】生成本轮对话的 1-2 句核心摘要。结合用户画像，突出本轮与之前不同的新信息。',
  ].join('\n');
}

function buildPreferencePrompt(
  existingMemory: Awaited<ReturnType<typeof loadMemory>>,
  conversationText: string
): string {
  return [
    buildUserContext(existingMemory),
    '',
    '【本次对话】',
    conversationText.slice(0, 4000),
    '',
    '【任务】只提取用户明确表达的**新增偏好或变化**。已有偏好不要重复输出，没有变化返回 {}。',
  ].join('\n');
}

// ── 主流程 ─────────────────────────────────────────────────

async function processMemoryUpdate(convId: string, messages: Array<{ role: string; content: string }>) {
  try {
    const existingMemory = await loadMemory();

    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n');

    // ── 即时任务：会话结束后串行执行，间隔 30 秒 ───────────
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const settings = await loadSettings();
    const TASK_INTERVAL_MS = settings.memory.taskIntervalMs;

    logger.info('Memory', `Starting immediate tasks for ${convId}`);

    logger.info('Memory', 'Task: profile extraction');
    const profileResult = await safeCallLLM('profile', PROFILE_SYSTEM_PROMPT, buildProfilePrompt(existingMemory, conversationText));
    await sleep(TASK_INTERVAL_MS);

    logger.info('Memory', 'Task: note familiarity');
    const noteResult = await safeCallLLM('noteFamiliarity', NOTE_FAMILIARITY_SYSTEM_PROMPT, buildNoteFamiliarityPrompt(existingMemory, conversationText));
    await sleep(TASK_INTERVAL_MS);

    logger.info('Memory', 'Task: digest generation');
    const digestResult = await safeCallLLM('digest', DIGEST_SYSTEM_PROMPT, buildDigestPrompt(existingMemory, conversationText));
    await sleep(TASK_INTERVAL_MS);

    logger.info('Memory', 'Task: preference extraction');
    const prefResult = await safeCallLLM('preference', PREFERENCE_SYSTEM_PROMPT, buildPreferencePrompt(existingMemory, conversationText));

    // 合并各即时任务结果
    const extracted: MemoryExtractResult = {};

    if (profileResult) {
      const p = profileResult as Record<string, unknown>;
      if (p.role || p.interests || p.background) {
        extracted.profileChanges = {
          role: p.role as string | undefined,
          interests: p.interests as string[] | undefined,
          background: p.background as string | undefined,
        };
      }
    }

    if (noteResult) {
      const n = noteResult as Record<string, unknown>;
      if (n.noteFamiliarity && Array.isArray(n.noteFamiliarity)) {
        extracted.noteFamiliarity = n.noteFamiliarity as MemoryExtractResult['noteFamiliarity'];
      }
    }

    if (digestResult) {
      const d = digestResult as Record<string, unknown>;
      if (d.newDigest) extracted.newDigest = d.newDigest as string;
    }

    if (prefResult) {
      const p = prefResult as Record<string, unknown>;
      if (p.preferenceSignals && typeof p.preferenceSignals === 'object') {
        extracted.preferenceSignals = p.preferenceSignals as Record<string, unknown>;
      }
    }

    const changedFields: string[] = [];
    if (extracted.profileChanges) changedFields.push('profile');
    if (extracted.noteFamiliarity) changedFields.push('notes');
    if (extracted.newDigest) changedFields.push('digest');
    if (extracted.preferenceSignals) changedFields.push('prefs');

    const hasContent = changedFields.length > 0;

    if (hasContent) {
      logger.info('Memory', `Merging changes [${changedFields.join(', ')}] for ${convId}`);
      const updated = mergeMemory(existingMemory, extracted, convId);
      await saveMemory(updated);

      const statusChanges = await evolveNoteStatuses(updated);
      if (statusChanges.length > 0) {
        logger.info('Memory', `Status changes: ${statusChanges.map(c => `${c.noteId}: ${c.from}→${c.to}`).join(', ')}`);
      }

      logger.info('Memory', `Immediate update done for ${convId}`);
    } else {
      const reasons: string[] = [];
      if (!profileResult) reasons.push('profile-failed');
      if (!noteResult) reasons.push('note-failed');
      if (!digestResult) reasons.push('digest-failed');
      if (!prefResult) reasons.push('pref-failed');
      if (reasons.length === 0) reasons.push('all-empty');
      logger.info('Memory', `No immediate content for ${convId}: ${reasons.join(', ')}`);
    }

    // ── 延迟任务：空闲时重新生成 "最近讨论" ────────────────
    // 只要有新的 newDigest 被追加，就 reschedule 延迟生成
    if (extracted.newDigest) {
      scheduleDiscussionRegen();
    }
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
