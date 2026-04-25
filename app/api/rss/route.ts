import { FileSystemStorage } from '@/lib/storage';
import { fetchRSS, rssItemToInbox } from '@/lib/ingestion/rss';

export async function POST(req: Request) {
  const { url, name, maxItems = 5 } = await req.json();

  if (!url) {
    return Response.json({ error: 'RSS URL required' }, { status: 400 });
  }

  try {
    const items = await fetchRSS(url);
    const storage = new FileSystemStorage();
    const entries = [];

    for (const item of items.slice(0, maxItems)) {
      const entry = rssItemToInbox(item, name || url);
      await storage.writeInbox(entry);
      entries.push({ title: item.title, link: item.link });
    }

    return Response.json({ ok: true, count: entries.length, entries });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
