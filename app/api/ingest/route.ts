import { enqueue } from '@/lib/queue';
import { FileSystemStorage } from '@/lib/storage';

export async function POST(req: Request) {
  let body: { type?: unknown; content?: unknown; title?: unknown; url?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { type, content, title, url } = body;
  const storage = new FileSystemStorage();

  try {
    if (type === 'text') {
      await storage.writeInbox({
        sourceType: 'text',
        title: typeof title === 'string' ? title : '用户输入',
        content: typeof content === 'string' ? content : '',
        rawMetadata: {},
      });
      return Response.json({ ok: true });
    }

    if (type === 'link') {
      if (typeof url !== 'string') {
        return Response.json({ error: 'URL required for link ingest' }, { status: 400 });
      }
      const taskId = enqueue('web_fetch', { url });
      return Response.json({ ok: true, taskId, message: '已加入抓取队列' }, { status: 202 });
    }

    return Response.json({ error: 'Unknown ingest type' }, { status: 400 });
  } catch (err) {
    console.error('[Ingest] Failed to process ingest:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
