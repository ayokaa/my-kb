import { FileSystemStorage } from '@/lib/storage';
import { fetchWebContent } from '@/lib/ingestion/web';

export async function POST(req: Request) {
  const { type, content, title, url } = await req.json();
  const storage = new FileSystemStorage();

  try {
    if (type === 'text') {
      await storage.writeInbox({
        sourceType: 'text',
        title: title || '用户输入',
        content: content || '',
        rawMetadata: {},
      });
      return Response.json({ ok: true });
    }

    if (type === 'link') {
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
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
