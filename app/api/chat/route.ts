import { formatStreamPart } from 'ai';
import Anthropic from '@anthropic-ai/sdk';
import { FileSystemStorage } from '@/lib/storage';
import { search, assembleContext, contentFallback } from '@/lib/search/engine';
import { loadOrBuildIndex } from '@/lib/search/cache';
import { fetchWebContent } from '@/lib/ingestion/web';
import { isValidHttpUrl } from '@/lib/ingestion/rss';
import { getLLMClient, getLLMModel } from '@/lib/llm';
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

  // 构建查询：取最近 3 轮用户消息拼接，让检索能利用对话上下文
  const recentUserMessages = messages
    .filter((m) => m.role === 'user')
    .slice(-3)
    .map((m) => m.content);
  const query = recentUserMessages.join(' ');

  // 加载笔记和索引
  const storage = new FileSystemStorage();
  const notes = await storage.listNotes();
  const index = await loadOrBuildIndex(storage, notes);

  // 执行检索
  let contextText = '';
  let searchResults: Array<{ id: string; title: string; score: number }> = [];

  if (notes.length > 0 && query.length > 0) {
    let results = search(query, notes, index, {
      statusFilter: ['seed', 'growing', 'evergreen', 'stale'],
      enableDiffusion: true,
      diffusionDepth: 1,
      diffusionDecay: 0.3,
    });

    // rg content fallback: 结构化搜索结果太少时，用 rg 扫正文兜底
    if (results.length < 3) {
      const hitIds = new Set(results.map((r) => r.note.id));
      const fallbackIds = await contentFallback(query, storage.getRoot(), hitIds);
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
      logger.info('Chat', `Retrieved ${results.length} notes for query: "${query.slice(0, 50)}" — top: ${topScores}`);
    } else {
      logger.info('Chat', `No relevant notes found for query: "${query.slice(0, 50)}"`);
    }
  } else {
    logger.info('Chat', `Skipping search: ${notes.length} notes, query length ${query.length}`);
  }

  // 拆分 system prompt：固定部分 + 动态检索部分
  const baseSystem =
    '你是用户的个人知识库助手。当用户消息中提供了知识库检索结果时，优先基于这些内容作答并引用来源笔记。如果知识库中没有相关信息，明确告知用户，然后可以补充一般性知识，但要明确区分两者。\n\n【对话原则】当用户输入简短、模糊或无明显意图时（如单个字、表情符号、打招呼），简短自然地回应，不要主动罗列知识库内容或展开长篇解释。只有在用户明确提出问题或表达求知意图时才检索和引用知识库。';

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
    ? `【知识库检索结果】以下是从用户知识库中检索到的相关信息，请优先基于这些内容回答。如果信息不足，请明确说明。\n\n---\n${contextText}\n---\n\n【回答要求】\n1. 优先使用上述知识库内容\n2. 如果引用了知识库内容，请提及来源笔记名称\n3. 如果知识库内容不足以回答，明确说明"知识库中没有相关信息"\n4. 不要编造知识库中没有的信息`
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
