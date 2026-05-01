import { enqueue } from '@/lib/queue';
import { logger } from '@/lib/logger';

export async function POST(req: Request) {
  let body: { type?: unknown; content?: unknown; title?: unknown; url?: unknown; hint?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { type, content, title, url, hint } = body;

  try {
    if (type === 'text') {
      const taskId = enqueue('ingest', {
        title: typeof title === 'string' ? title : '用户输入',
        content: typeof content === 'string' ? content : '',
        sourceType: 'text',
        rawMetadata: {},
        userHint: typeof hint === 'string' ? hint : undefined,
      });
      return Response.json({ ok: true, taskId, message: '已加入处理队列' });
    }

    if (type === 'link') {
      if (typeof url !== 'string') {
        return Response.json({ error: 'URL required for link ingest' }, { status: 400 });
      }
      const taskId = enqueue('web_fetch', {
        url,
        userHint: typeof hint === 'string' ? hint : undefined,
      });
      return Response.json({ ok: true, taskId, message: '已加入抓取队列' }, { status: 202 });
    }

    return Response.json({ error: 'Unknown ingest type' }, { status: 400 });
  } catch (err) {
    logger.error('Ingest', 'Failed to process ingest', { error: err });
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
