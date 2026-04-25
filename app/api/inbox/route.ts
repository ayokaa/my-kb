import { FileSystemStorage } from '@/lib/storage';

export async function GET() {
  const storage = new FileSystemStorage();
  try {
    const entries = await storage.listInbox();
    return Response.json({ entries });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
