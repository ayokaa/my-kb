import { listTasks, listPending, retryTask } from '@/lib/queue';

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

export async function POST(req: Request) {
  try {
    const { action, taskId } = await req.json();

    if (action === 'retry' && taskId) {
      const task = retryTask(taskId);
      if (!task) {
        return Response.json({ error: 'Task not found or not in failed state' }, { status: 400 });
      }
      return Response.json({ task });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
