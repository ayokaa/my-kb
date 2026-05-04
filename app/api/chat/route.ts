import { formatStreamPart } from 'ai';
import Anthropic from '@anthropic-ai/sdk';
import { FileSystemStorage } from '@/lib/storage';
import { search, assembleContext, contentFallback } from '@/lib/search/engine';
import { loadOrBuildIndex } from '@/lib/search/cache';
import { fetchWebContent } from '@/lib/ingestion/web';
import { isValidHttpUrl } from '@/lib/ingestion/rss';
import { getLLMClient, getLLMModel, getLLM } from '@/lib/llm';
import { loadMemory, getChatContext } from '@/lib/memory';
import { logger } from '@/lib/logger';

const MAX_MESSAGE_LENGTH = 10000;
const MAX_TOOL_CALLS = 3;
const MAX_AGENT_ROUNDS = 2;

/** Anthropic 工具定义 */
const anthropicTools: Anthropic.Messages.Tool[] = [
  {
    name: 'web_fetch',
    description:
      '当知识库内容不足以回答用户问题时，抓取指定网页获取更详细、更新的信息。仅当用户明确提供了 URL 时才使用，不要编造 URL。',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string' as const,
          description: '要抓取的完整 HTTP/HTTPS 链接',
        },
        reason: {
          type: 'string' as const,
          description: '简要说明为什么需要抓取这个网页（1-2句话）',
        },
      },
      required: ['url', 'reason'],
    },
  },
];

function validateMessages(messages: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') {
      throw new Error('Each message must be an object');
    }
    const record = msg as Record<string, unknown>;
    const role = record.role;
    const content = record.content;
    if (!['system', 'user', 'assistant'].includes(String(role))) {
      throw new Error('Invalid message role');
    }
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('Invalid message content');
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message exceeds max length of ${MAX_MESSAGE_LENGTH}`);
    }
  }
  return messages as Array<{ role: string; content: string }>;
}

/** 过滤 think 标签及其内容 */
function filterThink(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

interface StreamResult {
  text: string;
  toolCalls: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

/**
 * 将内部 OpenAI 风格消息转换为 Anthropic MessageParam 数组，并提取 system prompt。
 */
function toAnthropicParams(openaiMessages: any[]): {
  system?: string;
  messages: Anthropic.MessageParam[];
} {
  let system: string | undefined;
  const anthropicMessages: Anthropic.MessageParam[] = [];

  for (const msg of openaiMessages) {
    if (msg.role === 'system') {
      system = msg.content;
      continue;
    }
    if (msg.role === 'user') {
      if (msg.tool_call_id) {
        // tool result
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            } as Anthropic.ToolResultBlockParam,
          ],
        });
      } else {
        anthropicMessages.push({
          role: 'user',
          content: msg.content,
        });
      }
      continue;
    }
    if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          } as Anthropic.ToolUseBlockParam);
        }
        anthropicMessages.push({ role: 'assistant', content });
      } else {
        anthropicMessages.push({
          role: 'assistant',
          content: msg.content,
        });
      }
      continue;
    }
  }

  return { system, messages: anthropicMessages };
}

// ── LLM Query Rewriter ──────────────────────────────────────

const REWRITE_SYSTEM_PROMPT = `你是一个查询重写助手。你的任务是将多轮对话历史转换为一个简洁的搜索查询，用于从知识库中检索相关笔记。

规则：
1. 必须包含用户当前问题的核心意图
2. 将对话中的指代词（"那"、"这个"、"它"、"前者"）替换为具体指代的对象
3. 包含对话中累积的所有关键主题和概念
4. 使用名词和关键词，不要保留疑问句式
5. 如果对话涉及多个主题，优先保留当前轮次的主题，同时保留必要的上下文主题
6. 查询语言与用户问题保持一致
7. 只输出查询字符串，不要解释、不要加引号、不要有多余内容`;

function buildRewritePrompt(messages: Array<{ role: string; content: string }>): string {
  const history = messages
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
    .join('\n\n');

  return `请基于以下对话历史，生成一个用于知识库检索的查询。\n\n对话历史：\n\n${history}\n\n检索查询：`;
}

async function rewriteQuery(
  client: Anthropic,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const original = messages.at(-1)?.content || '';

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 256,
      temperature: 0.1,
      system: REWRITE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildRewritePrompt(messages) }],
    });

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    const raw = textBlocks.map((b) => b.text).join('').trim();
    const rewritten = raw.slice(0, 200);

    if (!rewritten) {
      throw new Error('Empty rewrite result');
    }

    logger.info('Chat', `Query rewritten: "${original.slice(0, 50)}" → "${rewritten.slice(0, 100)}"`);
    return rewritten;
  } catch (err) {
    logger.warn('Chat', `Query rewrite failed, fallback to original: ${(err as Error).message}`);
    return original;
  }
}

/**
 * 处理单轮流式响应，实时转发文本，收集 tool_calls。
 */
async function processStreamRound(
  stream: AsyncIterable<Anthropic.MessageStreamEvent>,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<StreamResult> {
  let textBuffer = '';
  const toolCallsMap = new Map<
    number,
    { id: string; name: string; inputJson: string }
  >();
  let inThink = false;
  let thinkBuffer = '';

  for await (const event of stream) {
    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          toolCallsMap.set(event.index, {
            id: block.id,
            name: block.name,
            inputJson: '',
          });
        }
        break;
      }

      case 'content_block_delta': {
        if (event.delta.type === 'text_delta') {
          const content = event.delta.text;
          let output = '';
          for (let i = 0; i < content.length; i++) {
            const char = content[i];
            if (!inThink) {
              thinkBuffer += char;
              if (thinkBuffer.endsWith('<think>')) {
                inThink = true;
                thinkBuffer = '';
              } else if (thinkBuffer.length > 7) {
                output += thinkBuffer[0];
                thinkBuffer = thinkBuffer.slice(1);
              }
            } else {
              thinkBuffer += char;
              if (thinkBuffer.endsWith('</think>')) {
                inThink = false;
                thinkBuffer = '';
              }
            }
          }
          if (!inThink && thinkBuffer.length > 0 && !thinkBuffer.includes('<think>')) {
            output += thinkBuffer;
            thinkBuffer = '';
          }

          if (output) {
            textBuffer += output;
            controller.enqueue(encoder.encode(formatStreamPart('text', output)));
          }
        } else if (event.delta.type === 'input_json_delta') {
          const tc = toolCallsMap.get(event.index);
          if (tc) {
            tc.inputJson += event.delta.partial_json;
          }
        }
        break;
      }

      case 'content_block_stop': {
        // content block 结束，不需要特殊处理
        break;
      }

      case 'message_stop': {
        break;
      }
    }
  }

  // 处理结尾剩余的非 think 内容
  if (!inThink && thinkBuffer.length > 0) {
    textBuffer += thinkBuffer;
    controller.enqueue(encoder.encode(formatStreamPart('text', thinkBuffer)));
  }

  const toolCalls = Array.from(toolCallsMap.values()).map((tc) => ({
    id: tc.id,
    type: 'function' as const,
    function: {
      name: tc.name,
      arguments: tc.inputJson,
    },
  }));

  return { text: textBuffer, toolCalls };
}

/**
 * 执行工具调用。
 */
async function executeToolCalls(
  toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
): Promise<Array<{ id: string; name: string; url: string; content: string }>> {
  const limitedCalls = toolCalls.slice(0, MAX_TOOL_CALLS);
  if (toolCalls.length > MAX_TOOL_CALLS) {
    logger.warn('Chat', `LLM returned ${toolCalls.length} tool calls, limiting to ${MAX_TOOL_CALLS}`);
  }

  const results: Array<{ id: string; name: string; url: string; content: string }> = [];

  for (const toolCall of limitedCalls) {
    if (toolCall.function?.name === 'web_fetch') {
      let args: { url?: string; reason?: string };
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }
      const url = args.url || '';
      logger.info('Chat', `Tool call web_fetch: ${url} (${args.reason || ''})`);

      if (url && isValidHttpUrl(url)) {
        try {
          const webContent = await fetchWebContent(url);
          results.push({
            id: toolCall.id,
            name: 'web_fetch',
            url,
            content: `网页标题: ${webContent.title}\n摘要: ${webContent.excerpt || ''}\n正文:\n${webContent.content.slice(0, 10000)}`,
          });
        } catch (err) {
          logger.error('Chat', 'web_fetch failed', { error: err });
          results.push({
            id: toolCall.id,
            name: 'web_fetch',
            url,
            content: `抓取失败: ${(err as Error).message}`,
          });
        }
      }
    }
  }

  return results;
}

export async function POST(req: Request) {
  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let messages: Array<{ role: string; content: string }>;
  try {
    messages = validateMessages(body.messages);
  } catch (err) {
    logger.error('Chat', 'Validation error', { error: err });
    return Response.json({ error: 'Invalid messages' }, { status: 400 });
  }

  // 判断是否需要查询重写（多轮对话时触发）
  const userMessageCount = messages.filter((m) => m.role === 'user').length;

  // 加载笔记和索引，与查询重写并行执行
  const storage = new FileSystemStorage();
  const notes = await storage.listNotes();

  const [searchQuery, index] = await Promise.all([
    userMessageCount >= 2
      ? getLLM()
          .then(({ client, model }) => rewriteQuery(client, model, messages))
          .catch(() => messages.at(-1)?.content || '')
      : Promise.resolve(messages.at(-1)?.content || ''),
    loadOrBuildIndex(storage, notes),
  ]);

  // 执行检索
  let contextText = '';
  let searchResults: Array<{ id: string; title: string; score: number }> = [];

  if (notes.length > 0 && searchQuery.length > 0) {
    let results = search(searchQuery, notes, index, {
      statusFilter: ['seed', 'growing', 'evergreen', 'stale'],
      enableDiffusion: true,
      diffusionDepth: 1,
      diffusionDecay: 0.3,
    });

    // rg content fallback: 结构化搜索结果太少时，用 rg 扫正文兜底
    if (results.length < 3) {
      const hitIds = new Set(results.map((r) => r.note.id));
      const fallbackIds = await contentFallback(searchQuery, storage.getRoot(), hitIds);
      for (const id of fallbackIds) {
        try {
          const note = await storage.loadNote(id);
          results.push({
            note,
            score: 0.3,
            hitFields: ['content'],
            isLinkDiffusion: false,
          });
        } catch {
          // note may have been deleted between rg and load
        }
      }
      // 按 score 重新排序
      results.sort((a, b) => b.score - a.score);
    }

    if (results.length > 0) {
      contextText = assembleContext(results);
      searchResults = results.map((r) => ({
        id: r.note.id,
        title: r.note.title,
        score: r.score,
      }));
      const topScores = results
        .slice(0, 5)
        .map((r) => `${r.note.title}(${r.score.toFixed(2)})`)
        .join(', ');
      logger.info('Chat', `Retrieved ${results.length} notes for query: "${searchQuery.slice(0, 50)}" — top: ${topScores}`);
    } else {
      logger.info('Chat', `No relevant notes found for query: "${searchQuery.slice(0, 50)}"`);
    }
  } else {
    logger.info('Chat', `Skipping search: ${notes.length} notes, query length ${searchQuery.length}`);
  }

  // 拆分 system prompt：固定部分 + 动态检索部分
  const baseSystem =
    `你是用户的个人知识库助手。你的核心任务是理解用户的真实问题，从知识库检索结果中提取相关信息，经过综合分析后给出有针对性的回答。

【检索结果格式说明】
知识库中的每篇笔记以如下结构化格式呈现，各字段含义如下：

- 【笔记: 标题】(ID: 标识)：笔记基本信息。
- 标签：笔记的分类标签，帮助你快速判断主题相关性。
- 来源：原始信息来源 URL，用于生成末尾的参考来源链接。
- 摘要：一句话提炼的核心主旨，优先阅读以把握笔记大意。
- 与我相关：这条信息对用户的个人价值，涉及"有什么用""如何应用"时优先参考。
- 关键事实：高度浓缩的核心事实（通常3-5条），回答事实性问题时优先引用，用自己的语言概括，禁止逐条复述。
- 时间线：相关的时间事件，涉及时效、演进类问题时参考。
- 问答（Q&A）：预设的常见问题与答案。如果用户问题高度匹配某个Q&A，可以借鉴其答案思路，但必须用自己的语言重新组织，严禁直接复制。
- 关联/反向链接：笔记间的知识网络，格式为 [[目标笔记标题]] #权重 — 关联原因。权重分为 strong（核心主题相同）、weak（主题相关）、context（仅在特定上下文相关）。跨笔记比较或延伸回答时参考。
- 正文：详细内容，提供背景信息。仅在需要深入理解时引用具体细节，禁止大段复制。

【回答原则】
1. 按需取材，拒绝堆砌：根据用户问题的类型，选择最相关的 1-3 个字段来组织回答，不要默认列出所有字段。
2. 深度整合，拒绝粘贴：禁止直接复制笔记原文。将多条笔记的相关信息融合成一段连贯、有针对性的回答，用自己的语言重新表达。
3. 引用规范：
   - 使用知识库信息时，在相关陈述后标注来源，格式为 [^笔记标题]。
   - 回答末尾必须单独列出"参考来源"：

   参考来源：
   - [笔记标题](URL) — 说明引用了哪些字段
   - [笔记标题] — 说明引用了哪些字段（无URL时）

4. 信息不足时：如果知识库内容不足以完整回答，必须明确说明"知识库中没有足够相关信息"，然后可以基于通用知识补充，并明确区分。

【对话原则】
当用户输入简短、模糊或无明显意图时（如单个字、表情符号、打招呼），简短自然地回应，不要主动罗列知识库内容或展开长篇解释。只有在用户明确提出问题或表达求知意图时才检索和引用知识库。`;

  const toolsSection = `【可用工具】
当知识库内容不足以回答问题时，你可以调用工具来获取更多信息。当前可用工具：
- web_fetch(url, reason): 抓取指定网页内容。你可以从知识库笔记的"来源"中选择 URL 进行抓取，不要编造不存在的 URL。

调用规则：仅在知识库内容明显不足时调用工具。如果知识库内容已足够，直接回答，不要调用工具。`;

  // 用户记忆上下文
  const memory = await loadMemory();
  const relevantNoteIds = searchResults.map((r) => r.id);
  const memoryContext = getChatContext(memory, relevantNoteIds);

  const fixedSystemPrompt = [baseSystem, memoryContext, toolsSection]
    .filter(Boolean)
    .join('\n\n');

  const contextSection = contextText
    ? `【知识库检索结果】以下是从用户知识库中检索到的相关信息，请按上述【回答原则】处理。\n\n---\n${contextText}\n---`
    : '【注意】当前知识库为空或没有与本次查询相关的笔记。你可以基于自己的知识回答，但请明确说明"知识库中没有相关信息"。';

  const client = await getLLMClient();
  const model = await getLLMModel();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 先发送检索来源数据
      if (searchResults.length > 0) {
        controller.enqueue(
          encoder.encode(formatStreamPart('data', [{ type: 'sources', notes: searchResults }]))
        );
      }

      // 构建初始 messages（OpenAI 风格内部格式）
      const contextMessage = `${contextSection}\n\n用户问题：${messages.at(-1)?.content || ''}`;
      let currentMessages: any[] = [
        { role: 'system', content: fixedSystemPrompt },
        ...messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: contextMessage },
      ];

      let round = 0;

      try {
        while (round < MAX_AGENT_ROUNDS) {
          round++;

          const isFirstRound = round === 1;
          const { system, messages: apiMessages } = toAnthropicParams(currentMessages);

          const response = await client.messages.create({
            model,
            max_tokens: 4096,
            system,
            messages: apiMessages,
            tools: isFirstRound ? anthropicTools : undefined,
            stream: true,
          });

          const { text, toolCalls } = await processStreamRound(response, controller, encoder);

          if (toolCalls.length === 0) {
            // 没有工具调用，本轮就是最终回答
            break;
          }

          // 执行工具
          const toolResultItems = await executeToolCalls(toolCalls);

          // 发送工具调用事件给前端
          for (const item of toolResultItems) {
            controller.enqueue(
              encoder.encode(
                formatStreamPart('data', [{ type: 'tool_call', name: item.name, url: item.url }])
              )
            );
          }

          // 构建下一轮 messages（保持 OpenAI 风格内部格式）
          currentMessages = [
            ...currentMessages,
            {
              role: 'assistant',
              content: text,
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: tc.type,
                function: { name: tc.function.name, arguments: tc.function.arguments },
              })),
            },
            ...toolResultItems.map((r) => ({
              role: 'tool',
              tool_call_id: r.id,
              content: r.content,
            })),
          ];
        }
      } catch (err) {
        logger.error('Chat', 'Stream error', { error: err });
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
