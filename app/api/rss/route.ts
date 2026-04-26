import { enqueue } from '@/lib/queue';

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const { url, name, maxItems = 5 } = await req.json();

  if (!url || typeof url !== 'string') {
    return Response.json({ error: 'RSS URL required' }, { status: 400 });
  }

  if (!isValidHttpUrl(url)) {
    return Response.json({ error: 'Invalid RSS URL' }, { status: 400 });
  }

  try {
    const taskId = enqueue('rss_fetch', { url, name, maxItems });
    return Response.json({ ok: true, taskId, message: 'RSS fetch queued' }, { status: 202 });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
