import { FileSystemStorage } from '@/lib/storage';
import { basename } from 'path';

export async function POST(req: Request) {
  let body: { fileName?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { fileName } = body;
  if (!fileName || typeof fileName !== 'string') {
    return Response.json({ error: 'fileName required' }, { status: 400 });
  }
  const safeFileName = basename(fileName);

  const storage = new FileSystemStorage();
  try {
    await storage.archiveInbox(safeFileName);
    return Response.json({ ok: true, message: '已归档' });
  } catch (err) {
    console.error('[Inbox Archive] Failed to archive:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
