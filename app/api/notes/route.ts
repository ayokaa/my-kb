import { FileSystemStorage } from '@/lib/storage';
import { contentFallback } from '@/lib/search/engine';
import { logger } from '@/lib/logger';

export async function GET(req: Request) {
  const storage = new FileSystemStorage();
  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search')?.trim();
  const startTime = Date.now();

  try {
    let notes = await storage.listNotes();

    // 后端全文搜索：用 rg 扫描笔记正文
    if (search && search.length > 0) {
      const rgStart = Date.now();
      const hitIds = new Set(await contentFallback(search, storage.getRoot(), new Set()));
      const rgMs = Date.now() - rgStart;

      // 也匹配标题/摘要
      const lowerSearch = search.toLowerCase();
      for (const note of notes) {
        if (
          note.title.toLowerCase().includes(lowerSearch) ||
          note.summary.toLowerCase().includes(lowerSearch) ||
          note.tags.some((t) => t.toLowerCase().includes(lowerSearch))
        ) {
          hitIds.add(note.id);
        }
      }
      notes = notes.filter((n) => hitIds.has(n.id));

      logger.info('Notes', `Search "${search}" — ${notes.length} results, rg:${rgMs}ms, total:${Date.now() - startTime}ms`);
    }

    return Response.json({ notes });
  } catch (err: any) {
    logger.error('Notes', `Search failed: ${(err as Error).message}`);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
