import { listTasks, listPending } from '@/lib/queue';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const filter = searchParams.get('filter');

  try {
    const tasks = filter === 'pending' ? listPending() : listTasks();
    return Response.json({ tasks });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
