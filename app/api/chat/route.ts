import { readFile } from 'fs/promises';
import { join } from 'path';
import OpenAI from 'openai';
import { formatStreamPart } from 'ai';
import { FileSystemStorage } from '@/lib/storage';
import { search, assembleContext } from '@/lib/search/engine';
import { buildIndex } from '@/lib/search/inverted-index';
import type { InvertedIndexMap } from '@/lib/search/types';

const client = new OpenAI({
  baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
  apiKey: process.env.MINIMAX_API_KEY || '',
});

/**
 * 加载或构建搜索索引。
 * 优先使用缓存的 search-index.json，不存在时全量重建。
 */
async function loadOrBuildIndex(storage: FileSystemStorage): Promise<InvertedIndexMap> {
  const root = storage.getRoot();
  const indexPath = join(root, 'meta', 'search-index.json');

  try {
    const raw = await readFile(indexPath, 'utf-8');
    const { deserializeIndex } = await import('@/lib/search/inverted-index');
    const parsed = deserializeIndex(raw);
    if (parsed) {
      return parsed.index;
    }
  } catch {
    // 缓存不存在或损坏，继续重建
  }

  // 全量重建
  const notes = await storage.listNotes();
  return buildIndex(notes);
}

const MAX_MESSAGE_LENGTH = 10000;

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

  // 获取最后一轮用户消息作为查询
  const lastUserMessage = messages[messages.length - 1];
  const query = lastUserMessage.content;

  // 加载笔记和索引
  const storage = new FileSystemStorage();
  const [notes, index] = await Promise.all([
    storage.listNotes(),
    loadOrBuildIndex(storage),
  ]);

  // 执行检索（包含所有状态的笔记）
  let contextText = '';
  let searchResults: Array<{ id: string; title: string; score: number }> = [];
  if (notes.length > 0 && query.length > 0) {
    const results = search(query, notes, index, {
      statusFilter: ['seed', 'growing', 'evergreen', 'stale'],
      limit: 5,
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
  const systemContent = contextText
    ? `${baseSystem}\n\n【知识库检索结果】以下是从用户知识库中检索到的相关信息，请优先基于这些内容回答。如果信息不足，请明确说明。\n\n---\n${contextText}\n---\n\n【回答要求】\n1. 优先使用上述知识库内容\n2. 如果引用了知识库内容，请提及来源笔记名称\n3. 如果知识库内容不足以回答，明确说明"知识库中没有相关信息"\n4. 不要编造知识库中没有的信息`
    : `${baseSystem}\n\n【注意】当前知识库为空或没有与本次查询相关的笔记。你可以基于自己的知识回答，但请明确说明"知识库中没有相关信息"。`;

  const response = await client.chat.completions.create({
    model: 'MiniMax-M2.7',
    messages: [
      { role: 'system', content: systemContent },
      ...messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
    ],
    stream: true,
  });

  // 自定义 ReadableStream：过滤 think + 发送来源数据
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 先发送检索来源数据
      if (searchResults.length > 0) {
        controller.enqueue(
          encoder.encode(formatStreamPart('data', [{ type: 'sources', notes: searchResults }]))
        );
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
