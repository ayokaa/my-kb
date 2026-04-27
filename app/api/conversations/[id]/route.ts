import { FileSystemStorage } from '@/lib/storage';
import type { ConversationTurn } from '@/lib/types';

function turnsToMessages(turns: ConversationTurn[]) {
  return turns.map((t, i) => ({
    id: `turn-${i}`,
    role: t.role === 'agent' ? 'assistant' : t.role,
    content: t.content,
    createdAt: t.timestamp || new Date().toISOString(),
  }));
}

function messagesToTurns(messages: Array<{ role: string; content: string; createdAt?: string }>): ConversationTurn[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'agent' : 'user',
    content: m.content,
    timestamp: m.createdAt || new Date().toISOString(),
  }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const storage = new FileSystemStorage();
    const conv = await storage.loadConversation(id);
    return Response.json({
      id: conv.id,
      title: conv.topics[0] || '对话',
      messages: turnsToMessages(conv.turns),
    });
  } catch (err) {
    console.error(`[Conversations API] Failed to load ${(await params).id}:`, err);
    return Response.json({ error: 'Conversation not found' }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const storage = new FileSystemStorage();
    await storage.deleteConversation(id);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`[Conversations API] Failed to delete ${(await params).id}:`, err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const messages = body.messages;
    if (!Array.isArray(messages)) {
      return Response.json({ error: 'messages array required' }, { status: 400 });
    }

    const storage = new FileSystemStorage();
    let conv;
    try {
      conv = await storage.loadConversation(id);
    } catch {
      // Create new if not exists
      conv = {
        id,
        date: new Date().toISOString(),
        topics: ['新对话'],
        status: 'open',
        turns: [],
        agentActions: [],
      };
    }

    conv.turns = messagesToTurns(messages);
    if (messages.length > 0 && messages[0].content) {
      const firstUser = messages.find((m: any) => m.role === 'user');
      if (firstUser) {
        conv.topics = [firstUser.content.slice(0, 30)];
      }
    }

    await storage.saveConversation(conv);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`[Conversations API] Failed to save ${(await params).id}:`, err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
