import { enqueue } from '@/lib/queue';
import { isValidHttpUrl } from '@/lib/ingestion/rss';
import { logger } from '@/lib/logger';

export async function POST(req: Request) {
  let body: { url?: unknown; name?: unknown; maxItems?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { url, name, maxItems = 5 } = body;

  if (!url || typeof url !== 'string') {
    return Response.json({ error: 'RSS URL required' }, { status: 400 });
  }

  if (!isValidHttpUrl(url)) {
    return Response.json({ error: 'Invalid RSS URL' }, { status: 400 });
  }

  try {
    const taskId = enqueue('rss_fetch', { url, name: typeof name === 'string' ? name : undefined, maxItems: typeof maxItems === 'number' ? maxItems : 5 });
    return Response.json({ ok: true, taskId, message: 'RSS fetch queued' }, { status: 202 });
  } catch (err) {
    logger.error('RSS', 'Failed to enqueue RSS fetch', { error: err });
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
