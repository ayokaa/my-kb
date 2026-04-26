import { fetchRSS } from '@/lib/ingestion/rss';
import { ingestRSSItems } from '@/lib/rss/manager';

export async function POST(req: Request) {
  const { url, name, maxItems = 5 } = await req.json();

  if (!url) {
    return Response.json({ error: 'RSS URL required' }, { status: 400 });
  }

  try {
    const items = await fetchRSS(url);
    const entries = await ingestRSSItems(url, name || url, items, maxItems);

    return Response.json({ ok: true, count: entries.length, entries });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
