import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const minimax = createOpenAI({
  name: 'minimax',
  baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
  apiKey: process.env.MINIMAX_API_KEY || '',
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: minimax('MiniMax-M2.5'),
    system: '你是用户的个人知识库助手。基于已有知识回答，不确定时坦诚告知。',
    messages,
  });

  return result.toDataStreamResponse();
}
