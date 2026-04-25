import { enqueue } from '@/lib/queue';

export async function POST(req: Request) {
  const { fileName } = await req.json();
  if (!fileName) {
    return Response.json({ error: 'fileName required' }, { status: 400 });
  }

  try {
    const taskId = enqueue('ingest', { fileName });
    return Response.json({ ok: true, taskId, message: '已加入处理队列' }, { status: 202 });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
