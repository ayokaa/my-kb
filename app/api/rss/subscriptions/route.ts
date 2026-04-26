import { listSubscriptions, addSubscription, removeSubscription } from '@/lib/rss/manager';
import { isValidHttpUrl } from '@/lib/ingestion/rss';

export async function GET() {
  try {
    const subs = await listSubscriptions();
    return Response.json({ subscriptions: subs });
  } catch (err) {
    console.error('[RSS API] Failed to list subscriptions:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { url?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { url, name } = body;
  if (!url || typeof url !== 'string') {
    return Response.json({ error: 'URL required' }, { status: 400 });
  }
  if (!isValidHttpUrl(url)) {
    return Response.json({ error: 'Invalid URL' }, { status: 400 });
  }
  try {
    const sub = await addSubscription(url, typeof name === 'string' ? name : undefined);
    return Response.json({ ok: true, subscription: sub });
  } catch (err) {
    console.error('[RSS API] Failed to add subscription:', err);
    return Response.json({ error: 'Internal error' }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { url } = body;
  if (!url || typeof url !== 'string') {
    return Response.json({ error: 'URL required' }, { status: 400 });
  }
  try {
    await removeSubscription(url);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[RSS API] Failed to remove subscription:', err);
    return Response.json({ error: 'Internal error' }, { status: 404 });
  }
}
