import { FileSystemStorage } from '@/lib/storage';
import { listPending } from '@/lib/queue';

export async function GET() {
  const storage = new FileSystemStorage();
  try {
    const entries = await storage.listInbox();
    const pending = listPending();
    const pendingFiles = new Set(pending.map((t) => (t.payload as { fileName?: string }).fileName).filter(Boolean));
    const visible = entries.filter((e) => !pendingFiles.has(e.filePath?.split('/').pop()));
    return Response.json({ entries: visible });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
