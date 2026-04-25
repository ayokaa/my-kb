import OpenAI from 'openai';
import { OpenAIStream, StreamingTextResponse } from 'ai';

const client = new OpenAI({
  baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
  apiKey: process.env.MINIMAX_API_KEY || '',
  dangerouslyAllowBrowser: true,
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  const response = await client.chat.completions.create({
    model: 'MiniMax-M2.7',
    messages: [
      { role: 'system', content: '你是用户的个人知识库助手。基于已有知识回答，不确定时坦诚告知。' },
      ...messages,
    ],
    stream: true,
  });

  const stream = OpenAIStream(response);
  return new StreamingTextResponse(stream);
}
