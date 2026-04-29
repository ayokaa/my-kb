import { FileSystemStorage } from '@/lib/storage';
import { emitNoteEvent } from '@/lib/events';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = new FileSystemStorage();
  try {
    const note = await storage.loadNote(decodeURIComponent(id));
    return Response.json({ note });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = new FileSystemStorage();
  try {
    const decodedId = decodeURIComponent(id);
    // 提前获取 note title 用于事件广播
    let title: string;
    try {
      const note = await storage.loadNote(decodedId);
      title = note.title;
    } catch {
      title = decodedId;
    }
    await storage.deleteNote(decodedId);
    emitNoteEvent('deleted', decodedId, title);
    return Response.json({ ok: true });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
