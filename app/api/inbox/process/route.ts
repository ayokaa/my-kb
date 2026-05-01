import { enqueue } from '@/lib/queue';
import { basename } from 'path';
import { logger } from '@/lib/logger';

export async function POST(req: Request) {
  let body: { fileName?: unknown; hint?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { fileName, hint } = body;
  if (!fileName || typeof fileName !== 'string') {
    return Response.json({ error: 'fileName required' }, { status: 400 });
  }
  const safeFileName = basename(fileName);

  try {
    const taskId = enqueue('ingest', {
      fileName: safeFileName,
      userHint: typeof hint === 'string' ? hint : undefined,
    });
    return Response.json({ ok: true, taskId, message: '已加入处理队列' }, { status: 202 });
  } catch (err) {
    logger.error('Inbox Process', 'Failed to enqueue task', { error: err });
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
