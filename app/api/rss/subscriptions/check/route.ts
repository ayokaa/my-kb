import { checkAllFeeds, checkFeed } from '@/lib/rss/manager';

export async function POST(req: Request) {
  const { url } = await req.json();
  try {
    const results = url ? [await checkFeed(url)] : await checkAllFeeds();
    return Response.json({ ok: true, results });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
