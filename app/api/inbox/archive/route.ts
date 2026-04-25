import { FileSystemStorage } from '@/lib/storage';

export async function POST(req: Request) {
  const { fileName } = await req.json();
  if (!fileName) {
    return Response.json({ error: 'fileName required' }, { status: 400 });
  }

  const storage = new FileSystemStorage();
  try {
    await storage.archiveInbox(fileName);
    return Response.json({ ok: true, message: '已归档' });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
