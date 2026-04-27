import { formatStreamPart } from 'ai';
import { FileSystemStorage } from '@/lib/storage';
import { search, assembleContext } from '@/lib/search/engine';
import { loadOrBuildIndex } from '@/lib/search/cache';
import { fetchWebContent } from '@/lib/ingestion/web';
import { isValidHttpUrl } from '@/lib/ingestion/rss';
import { getLLMClient, getLLMModel } from '@/lib/llm';

const MAX_MESSAGE_LENGTH = 10000;
const MAX_TOOL_CALLS = 3;

/** 定义可用工具 */
const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'web_fetch',
      description: '当知识库内容不足以回答用户问题时，抓取指定网页获取更详细、更新的信息。仅当用户明确提供了 URL 时才使用，不要编造 URL。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要抓取的完整 HTTP/HTTPS 链接',
          },
          reason: {
            type: 'string',
            description: '简要说明为什么需要抓取这个网页（1-2句话）',
          },
        },
        required: ['url', 'reason'],
      },
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
    const role = (msg as any).role;
    const content = (msg as any).content;
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
  // 处理多行 <think>...</think>
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
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
    console.error('[Chat] Validation error:', err);
    return Response.json({ error: 'Invalid messages' }, { status: 400 });
  }

  // 构建查询：取最近 3 轮用户消息拼接，让检索能利用对话上下文
  const recentUserMessages = messages
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content);
  const query = recentUserMessages.join(' ');

  // 加载笔记和索引（先获取 notes，再传入 loadOrBuildIndex 避免重复 listNotes）
  const storage = new FileSystemStorage();
  const notes = await storage.listNotes();
  const index = await loadOrBuildIndex(storage, notes);

  // 执行检索（包含所有状态的笔记）
  let contextText = '';
  let searchResults: Array<{ id: string; title: string; score: number }> = [];
  if (notes.length > 0 && query.length > 0) {
    const results = search(query, notes, index, {
      statusFilter: ['seed', 'growing', 'evergreen', 'stale'],
      enableDiffusion: true,
      diffusionDepth: 1,
      diffusionDecay: 0.3,
    });

    if (results.length > 0) {
      contextText = assembleContext(results);
      searchResults = results.map((r) => ({
        id: r.note.id,
        title: r.note.title,
        score: r.score,
      }));
      console.log(`[Chat] Retrieved ${results.length} notes for query: "${query.slice(0, 50)}"`);
    } else {
      console.log(`[Chat] No relevant notes found for query: "${query.slice(0, 50)}"`);
    }
  } else {
    console.log(`[Chat] Skipping search: ${notes.length} notes, query length ${query.length}`);
  }

  // 构建动态 system prompt
  const baseSystem = '你是用户的个人知识库助手。你的首要任务是使用下面提供的知识库内容来回答用户问题。如果知识库中有相关信息，请优先基于这些信息作答，并引用来源笔记。如果知识库中没有相关信息，请明确告知"根据我的知识库，没有找到相关信息"，然后可以补充你自己的一般性知识，但要明确区分两者。';
  let systemContent = contextText
    ? `${baseSystem}\n\n【知识库检索结果】以下是从用户知识库中检索到的相关信息，请优先基于这些内容回答。如果信息不足，请明确说明。\n\n---\n${contextText}\n---\n\n【回答要求】\n1. 优先使用上述知识库内容\n2. 如果引用了知识库内容，请提及来源笔记名称\n3. 如果知识库内容不足以回答，明确说明"知识库中没有相关信息"\n4. 不要编造知识库中没有的信息`
    : `${baseSystem}\n\n【注意】当前知识库为空或没有与本次查询相关的笔记。你可以基于自己的知识回答，但请明确说明"知识库中没有相关信息"。`;

  // 添加工具使用说明
  systemContent += `\n\n【可用工具】\n当知识库内容不足以回答问题时，你可以调用工具来获取更多信息。当前可用工具：\n- web_fetch(url, reason): 抓取指定网页内容。你可以从知识库笔记的"来源"中选择 URL 进行抓取，不要编造不存在的 URL。\n\n调用规则：仅在知识库内容明显不足时调用工具。如果知识库内容已足够，直接回答，不要调用工具。`;

  const client = await getLLMClient();
  const model = await getLLMModel();

  const apiMessages: any[] = [
    { role: 'system', content: systemContent },
    ...messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
  ];

  // 第一阶段：判断是否需要调用工具（非流式）
  let toolCalls: any[] | undefined;
  try {
    const toolResponse = await client.chat.completions.create({
      model,
      messages: apiMessages,
      tools,
      tool_choice: 'auto',
      stream: false,
    } as any);
    const assistantMsg = (toolResponse as any).choices?.[0]?.message;
    if (assistantMsg?.tool_calls && assistantMsg.tool_calls.length > 0) {
      toolCalls = assistantMsg.tool_calls;
    }
  } catch (err) {
    console.error('[Chat] Tool detection error:', err);
    // 降级：继续无工具调用
  }

  // 如果有工具调用，执行工具并构建新 messages
  let streamMessages = apiMessages;
  const toolResultItems: Array<{ id: string; name: string; url: string; content: string }> = [];

  if (toolCalls && toolCalls.length > 0) {
    const limitedCalls = toolCalls.slice(0, MAX_TOOL_CALLS);
    if (toolCalls.length > MAX_TOOL_CALLS) {
      console.warn(`[Chat] LLM returned ${toolCalls.length} tool calls, limiting to ${MAX_TOOL_CALLS}`);
    }
    for (const toolCall of limitedCalls) {
      if (toolCall.function?.name === 'web_fetch') {
        let args: { url?: string; reason?: string };
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          args = {};
        }
        const url = args.url || '';
        console.log(`[Chat] Tool call web_fetch: ${url} (${args.reason || ''})`);

        if (url && isValidHttpUrl(url)) {
          try {
            const webContent = await fetchWebContent(url);
            toolResultItems.push({
              id: toolCall.id,
              name: 'web_fetch',
              url,
              content: `网页标题: ${webContent.title}\n摘要: ${webContent.excerpt || ''}\n正文:\n${webContent.content.slice(0, 10000)}`,
            });
          } catch (err) {
            console.error(`[Chat] web_fetch failed:`, err);
            toolResultItems.push({
              id: toolCall.id,
              name: 'web_fetch',
              url,
              content: `抓取失败: ${(err as Error).message}`,
            });
          }
        }
      }
    }

    streamMessages = [
      ...apiMessages,
      {
        role: 'assistant',
        content: '',
        tool_calls: limitedCalls,
      },
      ...toolResultItems.map((r) => ({
        role: 'tool',
        tool_call_id: r.id,
        content: r.content,
      })),
    ];
  }

  // 第二阶段：流式输出最终回答
  const response = await client.chat.completions.create({
    model,
    messages: streamMessages,
    stream: true,
  } as any);

  // 自定义 ReadableStream：过滤 think + 发送来源数据 + 发送工具调用事件
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 先发送检索来源数据
      if (searchResults.length > 0) {
        controller.enqueue(
          encoder.encode(formatStreamPart('data', [{ type: 'sources', notes: searchResults }]))
        );
      }

      // 发送工具调用事件
      if (toolResultItems.length > 0) {
        for (const item of toolResultItems) {
          controller.enqueue(
            encoder.encode(
              formatStreamPart('data', [{ type: 'tool_call', name: item.name, url: item.url }])
            )
          );
        }
      }

      let inThink = false;
      let thinkBuffer = '';

      try {
        for await (const chunk of response as any) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (!content) continue;

          // 处理 think 标签（支持跨 chunk）
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

          // 如果不在 think 中，输出 buffer 中剩余的非 think 前缀
          if (!inThink && thinkBuffer.length > 0 && !thinkBuffer.includes('<think>')) {
            output += thinkBuffer;
            thinkBuffer = '';
          }

          if (output) {
            controller.enqueue(encoder.encode(formatStreamPart('text', output)));
          }
        }

        // 处理结尾：如果还有剩余的非 think 内容，输出
        if (!inThink && thinkBuffer.length > 0) {
          controller.enqueue(encoder.encode(formatStreamPart('text', thinkBuffer)));
        }

        // stream finished
      } catch (err) {
        console.error('[Chat] Stream error:', err);
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
