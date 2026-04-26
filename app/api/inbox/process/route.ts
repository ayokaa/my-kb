import { enqueue } from '@/lib/queue';
import { FileSystemStorage } from '@/lib/storage';

export async function POST(req: Request) {
  const { fileName } = await req.json();
  if (!fileName) {
    return Response.json({ error: 'fileName required' }, { status: 400 });
  }

  const storage = new FileSystemStorage();
  try {
    // Immediately archive the file so it disappears from inbox listing.
    // This prevents the same file from being re-enqueued if the user
    // refreshes before the queue worker finishes processing.
    await storage.archiveInbox(fileName);
    const taskId = enqueue('ingest', { fileName });
    return Response.json({ ok: true, taskId, message: '已加入处理队列' }, { status: 202 });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
