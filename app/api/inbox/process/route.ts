import { enqueue } from '@/lib/queue';
import { basename } from 'path';

export async function POST(req: Request) {
  let body: { fileName?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { fileName } = body;
  if (!fileName || typeof fileName !== 'string') {
    return Response.json({ error: 'fileName required' }, { status: 400 });
  }
  const safeFileName = basename(fileName);

  try {
    const taskId = enqueue('ingest', { fileName: safeFileName });
    return Response.json({ ok: true, taskId, message: '已加入处理队列' }, { status: 202 });
  } catch (err) {
    console.error('[Inbox Process] Failed to enqueue task:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
