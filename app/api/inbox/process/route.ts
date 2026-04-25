import { FileSystemStorage } from '@/lib/storage';
import { processInboxEntry } from '@/lib/cognition/ingest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import yaml from 'js-yaml';
import type { InboxEntry } from '@/lib/types';

function parseInboxRaw(raw: string, path: string): InboxEntry {
  const parts = raw.split('---');
  if (parts.length < 3) {
    return {
      sourceType: 'text',
      title: path.split('/').pop()?.replace('.md', '') || 'untitled',
      content: raw,
      rawMetadata: {},
      filePath: path,
    };
  }
  const fm = yaml.load(parts[1].trim()) as Record<string, unknown>;
  const content = parts.slice(2).join('---').trim();
  const rawMetadata: Record<string, unknown> = {};
  const known = new Set(['source_type', 'source_path', 'title', 'extracted_at']);
  for (const [k, v] of Object.entries(fm)) {
    if (!known.has(k)) rawMetadata[k] = v;
  }
  return {
    sourceType: String(fm.source_type || 'text') as InboxEntry['sourceType'],
    sourcePath: fm.source_path as string | undefined,
    title: String(fm.title || 'untitled'),
    content,
    extractedAt: fm.extracted_at as string | undefined,
    rawMetadata,
    filePath: path,
  };
}

export async function POST(req: Request) {
  const { fileName } = await req.json();
  if (!fileName) {
    return Response.json({ error: 'fileName required' }, { status: 400 });
  }

  const storage = new FileSystemStorage();
  const inboxDir = join(process.cwd(), 'knowledge', 'inbox');
  const filePath = join(inboxDir, fileName);

  try {
    const raw = await readFile(filePath, 'utf-8');
    const entry = parseInboxRaw(raw, filePath);

    const { note } = await processInboxEntry(entry);
    await storage.saveNote(note);
    await storage.archiveInbox(fileName);

    return Response.json({ ok: true, note });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
