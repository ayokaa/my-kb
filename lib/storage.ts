import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, readdir, mkdir, rename, unlink, stat } from 'fs/promises';
import { join, dirname, basename } from 'path';
import yaml from 'js-yaml';
import type { Storage, Note, Conversation, InboxEntry, InvertedIndex, InvertedIndexEntry, AliasMapping, SourceType } from './types';
import { parseNote, stringifyNote, parseInboxEntry } from './parsers';
import { logger } from './logger';
import { emitInboxEvent } from './events';

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
  private inboxWriteLock: Promise<void> = Promise.resolve();

  constructor(root?: string, execFileAsync?: ExecFileAsyncType) {
    this.root = root || join(/*turbopackIgnore: true*/ process.cwd(), process.env.KNOWLEDGE_ROOT || 'knowledge');
    this.execFileAsync = execFileAsync || defaultExecFileAsync;
  }

  private notePath(id: string): string {
    return join(this.root, 'notes', `${id}.md`);
  }

  private conversationPath(id: string): string {
    return join(this.root, 'conversations', `${id}.md`);
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

  async saveNote(note: Note, options?: { skipBacklinkRebuild?: boolean }): Promise<void> {
    if (!options?.skipBacklinkRebuild) {
      // 自动构建当前笔记的反向链接（扫描其他笔记的 links）
      const allNotes = await this.listNotes();
      const backlinks: typeof note.backlinks = [];
      const lowerTitle = note.title.toLowerCase();
      for (const other of allNotes) {
        if (other.id === note.id) continue;
        for (const link of other.links) {
          const lowerTarget = link.target.toLowerCase();
          if (
            lowerTarget === lowerTitle ||
            lowerTarget.includes(lowerTitle) ||
            lowerTitle.includes(lowerTarget)
          ) {
            backlinks.push({
              target: other.title,
              weight: link.weight,
              context: link.context,
            });
          }
        }
      }
      note.backlinks = backlinks;
    }

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
      logger.warn('Storage', 'Failed to update search index', { error: err });
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
        logger.warn('Storage', `Skip corrupted note "${id}"`, { error: err });
      }
    }
    // 按创建时间倒序（最新的在前）
    notes.sort((a, b) => b.created.localeCompare(a.created));
    return notes;
  }

  async rebuildBacklinks(): Promise<void> {
    const allNotes = await this.listNotes();

    // Reset all backlinks
    for (const n of allNotes) {
      n.backlinks = [];
    }

    // Rebuild from links（使用与 saveNote 自动构建一致的多匹配逻辑）
    for (const note of allNotes) {
      for (const link of note.links) {
        const lowerTarget = link.target.toLowerCase();
        for (const targetNote of allNotes) {
          if (targetNote.id === note.id) continue;
          const t = targetNote.title.toLowerCase();
          if (t === lowerTarget || t.includes(lowerTarget) || lowerTarget.includes(t)) {
            targetNote.backlinks.push({
              target: note.title,
              weight: link.weight,
              context: link.context,
            });
          }
        }
      }
    }

    // Save modified notes (skip auto-rebuild to avoid recursion)
    for (const note of allNotes) {
      await this.saveNote(note, { skipBacklinkRebuild: true });
    }
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
      logger.warn('Storage', 'Failed to clean up search index', { error: err });
    }

    // Rebuild backlinks since a note was removed
    try {
      await this.rebuildBacklinks();
    } catch (err) {
      logger.warn('Storage', 'Failed to rebuild backlinks after delete', { error: err });
    }
  }

  // ===== Conversation =====

  async loadConversation(id: string): Promise<Conversation> {
    const path = this.conversationPath(id);
    const raw = await readFile(path, 'utf-8');
    return this.parseConversation(raw, path);
  }

  async saveConversation(conv: Conversation): Promise<void> {
    const id = conv.id || conv.date;
    const path = this.conversationPath(id);
    conv.id = id;
    conv.updatedAt = new Date().toISOString();
    await this.atomicWrite(path, this.stringifyConversation(conv));
    conv.filePath = path;
  }

  async deleteConversation(id: string): Promise<void> {
    try {
      await unlink(this.conversationPath(id));
    } catch {
      // ignore if not exists
    }
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
      const id = basename(file, '.md');
      try {
        const conv = await this.loadConversation(id);
        if (!conv.id) conv.id = id;
        convs.push(conv);
      } catch (err) {
        logger.warn('Storage', `Skip corrupted conversation "${id}"`, { error: err });
      }
    }
    return convs.sort((a, b) => (b.updatedAt || b.date).localeCompare(a.updatedAt || a.date));
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
    await this.atomicWrite(path, yaml.dump(data, { allowUnicode: true } as import('./types').YamlDumpOptions));
  }

  // ===== Inbox =====

  /** Lightweight scan of inbox + archive/inbox to collect rss_link and source_url values. */
  private async _scanInboxSources(): Promise<{ rssLinks: Set<string>; sourceUrls: Set<string> }> {
    const rssLinks = new Set<string>();
    const sourceUrls = new Set<string>();

    const scanDir = async (dir: string) => {
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        return;
      }
      for (const file of files.filter((f) => f.endsWith('.md'))) {
        try {
          const raw = await readFile(join(dir, file), 'utf-8');
          if (!raw.startsWith('---')) continue;
          const endMarker = raw.indexOf('\n---', 3);
          if (endMarker === -1) continue;
          const fmRaw = raw.slice(3, endMarker).trim();
          const fm = yaml.load(fmRaw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
          if (typeof fm.rss_link === 'string' && fm.rss_link) rssLinks.add(fm.rss_link);
          if (typeof fm.source_url === 'string' && fm.source_url) sourceUrls.add(fm.source_url);
        } catch {
          // ignore corrupted files
        }
      }
    };

    await scanDir(join(this.root, 'inbox'));
    await scanDir(join(this.root, 'archive', 'inbox'));
    return { rssLinks, sourceUrls };
  }

  async writeInbox(entry: InboxEntry): Promise<boolean> {
    // Acquire lock to prevent race-condition duplicates
    const prevLock = this.inboxWriteLock;
    let releaseLock: (() => void) | undefined;
    this.inboxWriteLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await prevLock;

    try {
      const timestamp = Date.now();
      const slug = entry.title
        .slice(0, 30)
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9\-]/g, '');
      const fileName = `${timestamp}-${slug || 'untitled'}.md`;
      const path = this.inboxPath(fileName);

      // Deduplication guard: skip if inbox or archive already has the same rss_link or source_url
      const rssLink = entry.rawMetadata?.rss_link as string | undefined;
      const sourceUrl = entry.rawMetadata?.source_url as string | undefined;

      if (rssLink || sourceUrl) {
        try {
          const { rssLinks, sourceUrls } = await this._scanInboxSources();
          if (rssLink && rssLinks.has(rssLink)) {
            logger.info('Storage', `Skip duplicate inbox entry (rss_link already exists): ${entry.title}`);
            return false;
          }
          if (sourceUrl && sourceUrls.has(sourceUrl)) {
            logger.info('Storage', `Skip duplicate inbox entry (source_url already exists): ${entry.title}`);
            return false;
          }
        } catch {
          // Ignore scan errors, proceed with write
        }
      }

      const fm = {
        source_type: entry.sourceType,
        source_path: entry.sourcePath,
        title: entry.title,
        extracted_at: entry.extractedAt || new Date().toISOString(),
        ...entry.rawMetadata,
      };

      const content = `---\n${yaml.dump(fm, { allowUnicode: true } as import('./types').YamlDumpOptions)}---\n\n${entry.content}`;
      await this.atomicWrite(path, content);
      entry.filePath = path;
      // 通知客户端收件箱有新内容
      emitInboxEvent('new');
      return true;
    } finally {
      releaseLock?.();
    }
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
        entries.push(parseInboxEntry(raw, path));
      } catch (err) {
        logger.warn('Storage', `Skip corrupted inbox "${file}"`, { error: err });
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
    try {
      await stat(src);
    } catch {
      // File already archived or deleted, treat as idempotent
      return;
    }
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
        logger.warn('Git', stderr);
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

    const id = String(fm.id || basename(path, '.md'));
    const conv: Conversation = {
      id,
      date: String(fm.date || id),
      topics: Array.isArray(fm.topics) ? fm.topics.map(String) : [],
      status: (fm.status as Conversation['status']) || 'open',
      turns: [],
      agentActions: Array.isArray(fm.agent_actions) ? fm.agent_actions.map(String) : [],
      filePath: path,
      updatedAt: String(fm.updated_at || fm.date || ''),
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
      id: conv.id,
      date: conv.date,
      topics: conv.topics,
      status: conv.status,
      agent_actions: conv.agentActions,
      updated_at: conv.updatedAt,
    };

    const lines: string[] = [
      '---',
      yaml.dump(fm, { allowUnicode: true } as import('./types').YamlDumpOptions).trim(),
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
