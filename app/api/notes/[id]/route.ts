import { FileSystemStorage } from '@/lib/storage';
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
