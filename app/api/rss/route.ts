import { fetchRSS } from '@/lib/ingestion/rss';
import { ingestFeedItems } from '@/lib/rss/manager';

export async function POST(req: Request) {
  const { url, name, maxItems = 5 } = await req.json();

  if (!url) {
    return Response.json({ error: 'RSS URL required' }, { status: 400 });
  }

  try {
    const items = await fetchRSS(url);
    const results = await ingestFeedItems(url, name || url, items, maxItems);
    const entries = results.filter((r) => !r.skipped).map((r) => ({ title: r.title, link: r.link }));

    return Response.json({ ok: true, count: entries.length, entries });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
