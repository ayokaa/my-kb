import { importOPML } from '@/lib/rss/manager';

export async function POST(req: Request) {
  const { xml } = await req.json();
  if (!xml) {
    return Response.json({ error: 'OPML XML required' }, { status: 400 });
  }
  try {
    const result = await importOPML(xml);
    return Response.json({ ok: true, ...result });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
