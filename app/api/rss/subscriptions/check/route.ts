import { enqueue } from '@/lib/queue';
import { listSubscriptions } from '@/lib/rss/manager';

export async function POST(req: Request) {
  const { url } = await req.json();

  try {
    if (url) {
      const taskId = enqueue('rss_fetch', { url, isSubscriptionCheck: true });
      return Response.json({ ok: true, queued: 1, taskIds: [taskId] });
    }

    const sources = await listSubscriptions();
    const taskIds = sources.map((s) => enqueue('rss_fetch', { url: s.url, name: s.name, isSubscriptionCheck: true }));

    return Response.json({ ok: true, queued: taskIds.length, taskIds });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
