import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, readdir, mkdir, rename, unlink } from 'fs/promises';
import { join, dirname, basename } from 'path';
import yaml from 'js-yaml';
import type { Storage, Note, Conversation, InboxEntry, InvertedIndex, InvertedIndexEntry, AliasMapping, SourceType } from './types';
import { parseNote, stringifyNote } from './parsers';

let invertedIndexModule: typeof import('./search/inverted-index') | null = null;

async function getSearchIndexModule(): Promise<typeof import('./search/inverted-index')> {
  if (!invertedIndexModule) {
    invertedIndexModule = await import('./search/inverted-index');
  }
  return invertedIndexModule;
}

const defaultExecFileAsync = promisify(execFile);
type ExecFileAsyncType = typeof defaultExecFileAsync;

export class FileSystemStorage implements Storage {
  private readonly root: string;
  private readonly execFileAsync: ExecFileAsyncType;

  constructor(root?: string, execFileAsync?: ExecFileAsyncType) {
    this.root = root || join(process.cwd(), process.env.KNOWLEDGE_ROOT || 'knowledge');
    this.execFileAsync = execFileAsync || defaultExecFileAsync;
  }

  private notePath(id: string): string {
    return join(this.root, 'notes', `${id}.md`);
  }

  private conversationPath(date: string): string {
    return join(this.root, 'conversations', `${date}.md`);
  }

  private searchIndexPath(): string {
    return join(this.root, 'meta', 'search-index.json');
  }

  private inboxPath(fileName: string): string {
    return join(this.root, 'inbox', fileName);
  }

  private archiveNotePath(id: string): string {
    const date = new Date().toISOString().split('T')[0];
    return join(this.root, 'archive', `${id}-${date}.md`);
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${Date.now()}`;
    await writeFile(tmp, content);
    await rename(tmp, path);
  }

  // ===== Note CRUD =====

  async loadNote(id: string): Promise<Note> {
    const path = this.notePath(id);
    const raw = await readFile(path, 'utf-8');
    return parseNote(raw, path);
  }

  private async loadNoteFrontmatter(id: string): Promise<Record<string, unknown>> {
    const path = this.notePath(id);
    const raw = await readFile(path, 'utf-8');
    if (!raw.startsWith('---')) return {};
    const endMarker = raw.indexOf('\n---', 3);
    if (endMarker === -1) return {};
    const fmRaw = raw.slice(3, endMarker).trim();
    const parsed = yaml.load(fmRaw, { schema: yaml.JSON_SCHEMA });
    return (parsed as Record<string, unknown> | null) ?? {};
  }

  /** Light-weight scan: reads only frontmatter sources from all notes. */
  async listNoteSources(): Promise<Array<{ id: string; sources: string[] }>> {
    const dir = join(this.root, 'notes');
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }

    const entries = await Promise.all(
      files
        .filter((f) => f.endsWith('.md'))
        .map(async (file) => {
          const id = basename(file, '.md');
          try {
            const fm = await this.loadNoteFrontmatter(id);
            return { id, sources: Array.isArray(fm.sources) ? fm.sources.map(String) : [] };
          } catch {
            return null;
          }
        })
    );
    return entries.filter(Boolean) as Array<{ id: string; sources: string[] }>;
  }

  async saveNote(note: Note): Promise<void> {
    const path = this.notePath(note.id);
    await this.atomicWrite(path, stringifyNote(note));
    note.filePath = path;

    // Update search index
    try {
      const { buildNoteIndex, mergeIndexes, removeNoteFromIndex, serializeIndex } = await getSearchIndexModule();
      const indexPath = this.searchIndexPath();
      let existing: Awaited<ReturnType<typeof import('./search/inverted-index').deserializeIndex>> = null;
      try {
        const raw = await readFile(indexPath, 'utf-8');
        existing = (await getSearchIndexModule()).deserializeIndex(raw);
      } catch {
        // File may not exist
      }

      let indexMap = existing?.index ?? {};
      // Remove old entries for this note (if updating)
      indexMap = removeNoteFromIndex(indexMap, note.id);
      // Add new entries
      const noteIndex = buildNoteIndex(note);
      indexMap = mergeIndexes([indexMap, noteIndex]);

      // Derive noteIds from existing index instead of reading all notes (N+1 fix)
      let noteIds: string[];
      if (existing) {
        noteIds = Array.from(new Set([...existing.noteIds, note.id]));
      } else {
        // Index missing/corrupted — rebuild noteIds from disk (recovery path)
        const allNotes = await this.listNotes();
        noteIds = Array.from(new Set([...allNotes.map((n) => n.id), note.id]));
      }
      await this.atomicWrite(indexPath, serializeIndex(indexMap, noteIds));
    } catch (err) {
      console.warn('[Storage] Failed to update search index:', (err as Error).message);
    }
  }

  async listNotes(): Promise<Note[]> {
    const dir = join(this.root, 'notes');
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }

    const notes: Note[] = [];
    for (const file of files.filter(f => f.endsWith('.md'))) {
      const id = basename(file, '.md');
      try {
        notes.push(await this.loadNote(id));
      } catch (err) {
        console.warn(`[Storage] Skip corrupted note "${id}":`, (err as Error).message);
      }
    }
    return notes;
  }

  async deleteNote(id: string): Promise<void> {
    const src = this.notePath(id);
    const dst = this.archiveNotePath(id);
    await mkdir(dirname(dst), { recursive: true });
    await rename(src, dst);

    // Clean up inverted index
    try {
      const index = await this.loadIndex();
      const filtered = index.entries.filter((e) => e.noteId !== id);
      if (filtered.length !== index.entries.length) {
        await this.saveIndex({ entries: filtered });
      }
    } catch {
      // Index cleanup failure is non-critical
    }

    // Clean up search index
    try {
      const { removeNoteFromIndex, serializeIndex } = await getSearchIndexModule();
      const indexPath = this.searchIndexPath();
      let existing: Awaited<ReturnType<typeof import('./search/inverted-index').deserializeIndex>> = null;
      try {
        const raw = await readFile(indexPath, 'utf-8');
        existing = (await getSearchIndexModule()).deserializeIndex(raw);
      } catch {
        // File may not exist
      }

      if (existing) {
        const cleaned = removeNoteFromIndex(existing.index, id);
        const noteIds = existing.noteIds.filter(nid => nid !== id);
        await this.atomicWrite(indexPath, serializeIndex(cleaned, noteIds));
      }
    } catch (err) {
      console.warn('[Storage] Failed to clean up search index:', (err as Error).message);
    }
  }

  // ===== Conversation =====

  async loadConversation(date: string): Promise<Conversation> {
    const path = this.conversationPath(date);
    const raw = await readFile(path, 'utf-8');
    return this.parseConversation(raw, path);
  }

  async saveConversation(conv: Conversation): Promise<void> {
    const path = this.conversationPath(conv.date);
    await this.atomicWrite(path, this.stringifyConversation(conv));
    conv.filePath = path;
  }

  async listConversations(): Promise<Conversation[]> {
    const dir = join(this.root, 'conversations');
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }

    const convs: Conversation[] = [];
    for (const file of files.filter(f => f.endsWith('.md'))) {
      const date = basename(file, '.md');
      try {
        convs.push(await this.loadConversation(date));
      } catch (err) {
        console.warn(`[Storage] Skip corrupted conversation "${date}":`, (err as Error).message);
      }
    }
    return convs.sort((a, b) => a.date.localeCompare(b.date));
  }

  // ===== Meta: Inverted Index =====

  async loadIndex(): Promise<InvertedIndex> {
    const path = join(this.root, 'meta', 'inverted-index.md');
    try {
      const raw = await readFile(path, 'utf-8');
      return this.parseInvertedIndex(raw);
    } catch {
      return { entries: [] };
    }
  }

  async saveIndex(index: InvertedIndex): Promise<void> {
    const path = join(this.root, 'meta', 'inverted-index.md');
    await this.atomicWrite(path, this.stringifyInvertedIndex(index));
  }

  // ===== Meta: Aliases =====

  async loadAliases(): Promise<AliasMapping[]> {
    const path = join(this.root, 'meta', 'aliases.yml');
    try {
      const raw = await readFile(path, 'utf-8');
      const data = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as Record<string, string[]> | null;
      if (!data || typeof data !== 'object') return [];
      return Object.entries(data).map(([canonical, aliases]) => ({
        canonical,
        aliases: Array.isArray(aliases) ? aliases.map(String) : [],
      }));
    } catch {
      return [];
    }
  }

  async saveAliases(aliases: AliasMapping[]): Promise<void> {
    const path = join(this.root, 'meta', 'aliases.yml');
    const data = Object.fromEntries(aliases.map(a => [a.canonical, a.aliases]));
    await this.atomicWrite(path, yaml.dump(data, { allowUnicode: true } as any as any));
  }

  // ===== Inbox =====

  async writeInbox(entry: InboxEntry): Promise<void> {
    const timestamp = Date.now();
    const slug = entry.title
      .slice(0, 30)
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9\-]/g, '');
    const fileName = `${timestamp}-${slug || 'untitled'}.md`;
    const path = this.inboxPath(fileName);

    // Deduplication guard: skip if inbox already has the same rss_link
    const rssLink = entry.rawMetadata?.rss_link as string | undefined;
    if (rssLink) {
      try {
        const existing = await this.listInbox();
        const duplicate = existing.find(e => e.rawMetadata?.rss_link === rssLink);
        if (duplicate) {
          console.log(`[Storage] Skip duplicate inbox entry (rss_link already exists): ${entry.title}`);
          entry.filePath = duplicate.filePath;
          return;
        }
      } catch {
        // Ignore list errors, proceed with write
      }
    }

    const fm = {
      source_type: entry.sourceType,
      source_path: entry.sourcePath,
      title: entry.title,
      extracted_at: entry.extractedAt || new Date().toISOString(),
      ...entry.rawMetadata,
    };

    const content = `---\n${yaml.dump(fm, { allowUnicode: true } as any)}---\n\n${entry.content}`;
    await this.atomicWrite(path, content);
    entry.filePath = path;
  }

  async listInbox(): Promise<InboxEntry[]> {
    const dir = join(this.root, 'inbox');
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }

    const entries: InboxEntry[] = [];
    for (const file of files.filter(f => f.endsWith('.md'))) {
      const path = join(dir, file);
      try {
        const raw = await readFile(path, 'utf-8');
        entries.push(this.parseInboxEntry(raw, path));
      } catch (err) {
        console.warn(`[Storage] Skip corrupted inbox "${file}":`, (err as Error).message);
      }
    }
    return entries.sort((a, b) => {
      const getTime = (entry: InboxEntry): number => {
        if (entry.extractedAt) {
          const t = new Date(entry.extractedAt).getTime();
          if (!isNaN(t)) return t;
        }
        // fallback: extract timestamp from filename like 1234567890-slug.md
        const name = entry.filePath?.split('/').pop()?.split('-')[0];
        if (name) {
          const t = parseInt(name, 10);
          if (!isNaN(t)) return t;
        }
        return 0;
      };
      return getTime(b) - getTime(a);
    });
  }

  async archiveInbox(fileName: string): Promise<void> {
    const src = this.inboxPath(fileName);
    const dst = join(this.root, 'archive', 'inbox', fileName);
    await mkdir(dirname(dst), { recursive: true });
    await rename(src, dst);
  }

  // ===== Git =====

  getRoot(): string {
    return this.root;
  }

  async commit(message: string): Promise<void> {
    try {
      await this.execFileAsync('git', ['add', this.root], { cwd: process.cwd() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('nothing to commit') && !msg.includes('no changes added')) {
        throw err;
      }
    }

    try {
      const { stderr } = await this.execFileAsync('git', ['commit', '-m', message], { cwd: process.cwd() });
      if (stderr && !stderr.includes('nothing to commit') && !stderr.includes('no changes added')) {
        console.warn('[Git]', stderr);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('nothing to commit') && !msg.includes('no changes added')) {
        throw err;
      }
    }
  }

  // ===== Private: Parsers / Serializers =====

  private parseInvertedIndex(raw: string): InvertedIndex {
    const entries: InvertedIndexEntry[] = [];
    const lines = raw.split('\n');
    let currentTag: string | null = null;

    for (const line of lines) {
      const tagMatch = line.match(/^##\s+(.+)$/);
      if (tagMatch) {
        currentTag = tagMatch[1].trim();
        continue;
      }

      const noteMatch = line.match(/^-\s+\[\[(.+?)\]\](?:\s*—\s*(.*))?$/);
      if (noteMatch && currentTag) {
        entries.push({
          tag: currentTag,
          noteId: noteMatch[1],
          noteTitle: noteMatch[1],
          noteSummary: noteMatch[2] || '',
        });
      }
    }

    return { entries };
  }

  private stringifyInvertedIndex(index: InvertedIndex): string {
    const tagMap = new Map<string, InvertedIndexEntry[]>();
    for (const entry of index.entries) {
      if (!tagMap.has(entry.tag)) tagMap.set(entry.tag, []);
      tagMap.get(entry.tag)!.push(entry);
    }

    const lines = ['# 倒排索引', ''];
    for (const [tag, entries] of tagMap) {
      lines.push(`## ${tag}`);
      for (const e of entries) {
        const summary = e.noteSummary ? ` — ${e.noteSummary}` : '';
        lines.push(`- [[${e.noteId}]]${summary}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  private parseInboxEntry(raw: string, path: string): InboxEntry {
    if (!raw.startsWith('---')) {
      return {
        sourceType: 'text',
        title: basename(path, '.md'),
        content: raw,
        rawMetadata: {},
        filePath: path,
      };
    }
    const endMarker = raw.indexOf('\n---', 3);
    if (endMarker === -1) {
      return {
        sourceType: 'text',
        title: basename(path, '.md'),
        content: raw,
        rawMetadata: {},
        filePath: path,
      };
    }

    const fmRaw = raw.slice(3, endMarker).trim();
    const content = raw.slice(endMarker + 4).trim();
    const fm = yaml.load(fmRaw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;

    const known = new Set(['source_type', 'source_path', 'title', 'extracted_at']);
    const rawMetadata: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fm)) {
      if (!known.has(k)) rawMetadata[k] = v;
    }

    return {
      sourceType: ((fm.source_type as string) || 'text') as SourceType,
      sourcePath: fm.source_path as string | undefined,
      title: (fm.title as string) || basename(path, '.md'),
      content,
      extractedAt: fm.extracted_at as string | undefined,
      rawMetadata,
      filePath: path,
    };
  }

  private parseConversation(raw: string, path: string): Conversation {
    let fm: Record<string, unknown> = {};
    let body = raw;
    if (raw.startsWith('---')) {
      const endMarker = raw.indexOf('\n---', 3);
      if (endMarker !== -1) {
        const fmRaw = raw.slice(3, endMarker).trim();
        fm = yaml.load(fmRaw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
        body = raw.slice(endMarker + 4).trim();
      }
    }

    const conv: Conversation = {
      date: String(fm.date || basename(path, '.md')),
      topics: Array.isArray(fm.topics) ? fm.topics.map(String) : [],
      status: (fm.status as Conversation['status']) || 'open',
      turns: [],
      agentActions: Array.isArray(fm.agent_actions) ? fm.agent_actions.map(String) : [],
      filePath: path,
    };

    // Simple parser for Q/A blocks
    const blocks = body.split(/\*\*Q\*\*:\s*/);
    for (const block of blocks.slice(1)) {
      const qaParts = block.split('**A**:', 2);
      if (qaParts.length !== 2) continue;
      conv.turns.push(
        { role: 'user', content: qaParts[0].trim() },
        { role: 'agent', content: qaParts[1].trim() }
      );
    }

    return conv;
  }

  private stringifyConversation(conv: Conversation): string {
    const fm = {
      date: conv.date,
      topics: conv.topics,
      status: conv.status,
      agent_actions: conv.agentActions,
    };

    const lines: string[] = [
      '---',
      yaml.dump(fm, { allowUnicode: true } as any).trim(),
      '---',
      '',
    ];

    for (let i = 0; i < conv.turns.length; i += 2) {
      const q = conv.turns[i];
      const a = conv.turns[i + 1];
      if (q) lines.push(`**Q**: ${q.content}`, '');
      if (a) lines.push(`**A**: ${a.content}`, '');
    }

    return lines.join('\n');
  }
}
