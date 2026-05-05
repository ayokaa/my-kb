import { loadMemory, saveMemory, emptyMemory, evolveNoteStatuses, type UserProfile } from '@/lib/memory';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const memory = await loadMemory();
    return Response.json(memory);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const memory = await loadMemory();

    switch (body.action) {
      case 'updateProfile': {
        const p = body.profile as Partial<UserProfile>;
        if (p.role !== undefined) memory.profile.role = p.role || undefined;
        if (p.background !== undefined) memory.profile.background = p.background || undefined;
        if (p.techStack) memory.profile.techStack = p.techStack;
        if (p.interests) memory.profile.interests = p.interests;
        memory.profile.updatedAt = new Date().toISOString();
        break;
      }
      case 'updatePreference': {
        const { key, value } = body;
        if (typeof key !== 'string') {
          return Response.json({ error: 'key is required' }, { status: 400 });
        }
        if (value !== undefined && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          return Response.json({ error: 'value must be string, number, or boolean' }, { status: 400 });
        }
        memory.preferences[key] = value;
        break;
      }
      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

    await saveMemory(memory);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const memory = await loadMemory();

    switch (body.action) {
      case 'deleteNoteKnowledge': {
        const { noteId } = body;
        if (typeof noteId !== 'string') {
          return Response.json({ error: 'noteId is required' }, { status: 400 });
        }
        delete memory.noteKnowledge[noteId];
        break;
      }
      case 'deleteConversationDigest': {
        memory.conversationDigest = '';
        break;
      }
      case 'deletePreference': {
        const { key } = body;
        if (typeof key !== 'string') {
          return Response.json({ error: 'key is required' }, { status: 400 });
        }
        delete memory.preferences[key];
        break;
      }
      case 'clearAll': {
        const empty = emptyMemory();
        Object.assign(memory, empty);
        break;
      }
      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

    await saveMemory(memory);

    // 任何可能影响 noteKnowledge 的操作后，触发笔记状态演进
    const shouldEvolve = body.action === 'deleteNoteKnowledge' || body.action === 'clearAll';
    if (shouldEvolve) {
      try {
        const changes = await evolveNoteStatuses(memory);
        if (changes.length > 0) {
          logger.info('Memory', `Status changes after ${body.action}: ${changes.map((c) => `${c.noteId}: ${c.from}→${c.to}`).join(', ')}`);
        }
      } catch (evolveErr) {
        logger.error('Memory', `Status evolution failed after ${body.action}: ${(evolveErr as Error).message}`);
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
