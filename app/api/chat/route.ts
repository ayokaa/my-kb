import { readFile } from 'fs/promises';
import { join } from 'path';
import OpenAI from 'openai';
import { OpenAIStream, StreamingTextResponse } from 'ai';
import { FileSystemStorage } from '@/lib/storage';
import { search, assembleContext } from '@/lib/search/engine';
import { buildIndex } from '@/lib/search/inverted-index';
import type { InvertedIndexMap } from '@/lib/search/types';

const client = new OpenAI({
  baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
  apiKey: process.env.MINIMAX_API_KEY || '',
  dangerouslyAllowBrowser: true,
});

/**
 * 加载或构建搜索索引。
 * 优先使用缓存的 search-index.json，不存在时全量重建。
 */
async function loadOrBuildIndex(storage: FileSystemStorage): Promise<InvertedIndexMap> {
  const root = (storage as any).root as string;
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

export async function POST(req: Request) {
  const { messages } = await req.json();

  // 获取最后一轮用户消息作为查询
  const lastUserMessage = messages[messages.length - 1];
  const query = typeof lastUserMessage?.content === 'string'
    ? lastUserMessage.content
    : '';

  // 加载笔记和索引
  const storage = new FileSystemStorage();
  const [notes, index] = await Promise.all([
    storage.listNotes(),
    loadOrBuildIndex(storage),
  ]);

  // 执行检索
  let contextText = '';
  if (notes.length > 0 && query.length > 0) {
    const results = search(query, notes, index, {
      statusFilter: ['evergreen', 'growing'],
      limit: 5,
      enableDiffusion: true,
      diffusionDepth: 1,
      diffusionDecay: 0.3,
    });

    if (results.length > 0) {
      contextText = assembleContext(results);
    }
  }

  // 构建动态 system prompt
  const baseSystem = '你是用户的个人知识库助手。基于已有知识回答，不确定时坦诚告知。';
  const systemContent = contextText
    ? `${baseSystem}\n\n以下是从知识库中检索到的相关信息，请基于这些信息回答用户问题。如果信息不足以回答，请坦诚告知。\n\n---\n${contextText}\n---`
    : baseSystem;

  const response = await client.chat.completions.create({
    model: 'MiniMax-M2.7',
    messages: [
      { role: 'system', content: systemContent },
      ...messages,
    ],
    stream: true,
  });

  const stream = OpenAIStream(response as any);
  return new StreamingTextResponse(stream);
}
