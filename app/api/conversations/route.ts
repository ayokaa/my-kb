import { FileSystemStorage } from '@/lib/storage';
import type { Conversation } from '@/lib/types';
import { logger } from '@/lib/logger';

function convToResponse(conv: Conversation) {
  return {
    id: conv.id,
    date: conv.date,
    title: conv.topics[0] || '新对话',
    topics: conv.topics,
    status: conv.status,
    updatedAt: conv.updatedAt,
    turnCount: conv.turns.length,
  };
}

export async function GET() {
  try {
    const storage = new FileSystemStorage();
    const convs = await storage.listConversations();
    return Response.json({ conversations: convs.map(convToResponse) });
  } catch (err) {
    logger.error('Conversations API', 'Failed to list', { error: err });
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const title = typeof body.title === 'string' ? body.title : '新对话';
    // 允许客户端指定 ID（用于乐观创建），未提供则服务端生成
    const id = typeof body.id === 'string' ? body.id : `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const conv: Conversation = {
      id,
      date: new Date().toISOString(),
      topics: [title],
      status: 'open',
      turns: [],
      agentActions: [],
      updatedAt: new Date().toISOString(),
    };

    const storage = new FileSystemStorage();
    await storage.saveConversation(conv);

    return Response.json({ ok: true, conversation: convToResponse(conv) });
  } catch (err) {
    logger.error('Conversations API', 'Failed to create', { error: err });
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
