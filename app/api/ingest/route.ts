import { FileSystemStorage } from '@/lib/storage';
import { fetchWebContent } from '@/lib/ingestion/web';

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
      const web = await fetchWebContent(url);
      await storage.writeInbox({
        sourceType: 'web',
        title: web.title,
        content: web.content,
        rawMetadata: { source_url: url, excerpt: web.excerpt },
      });
      return Response.json({ ok: true, title: web.title });
    }

    return Response.json({ error: 'Unknown ingest type' }, { status: 400 });
  } catch (err) {
    console.error('[Ingest] Failed to process ingest:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
