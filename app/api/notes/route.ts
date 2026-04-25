import { FileSystemStorage } from '@/lib/storage';

export async function GET() {
  const storage = new FileSystemStorage();
  try {
    const notes = await storage.listNotes();
    return Response.json({ notes });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
