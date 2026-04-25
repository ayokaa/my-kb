import { listSubscriptions, addSubscription, removeSubscription } from '@/lib/rss/manager';

export async function GET() {
  try {
    const subs = await listSubscriptions();
    return Response.json({ subscriptions: subs });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { url, name } = await req.json();
  if (!url) {
    return Response.json({ error: 'URL required' }, { status: 400 });
  }
  try {
    const sub = await addSubscription(url, name);
    return Response.json({ ok: true, subscription: sub });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const { url } = await req.json();
  if (!url) {
    return Response.json({ error: 'URL required' }, { status: 400 });
  }
  try {
    await removeSubscription(url);
    return Response.json({ ok: true });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 404 });
  }
}
