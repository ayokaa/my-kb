import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileSystemStorage } from '../storage';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Note, InboxEntry, InvertedIndex, AliasMapping, Conversation } from '../types';



function createTestNote(id: string, overrides?: Partial<Note>): Note {
  return {
    id,
    title: id,
    tags: ['test'],
    status: 'seed',
    created: '2024-01-01',
    updated: '2024-01-01',
    sources: [],
    summary: `Summary of ${id}`,
    personalContext: '',
    keyFacts: [],
    timeline: [],
    links: [],
    qas: [],
    content: `Content of ${id}`,
    ...overrides,
  };
}

describe('FileSystemStorage', () => {
  let tmpDir: string;
  let storage: FileSystemStorage;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kb-test-'));
    storage = new FileSystemStorage(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ===== Note CRUD =====

  describe('saveNote / loadNote', () => {
    it('round-trips a note', async () => {
      const note = createTestNote('rag');
      await storage.saveNote(note);

      const loaded = await storage.loadNote('rag');
      expect(loaded.id).toBe('rag');
      expect(loaded.title).toBe('rag');
      expect(loaded.summary).toBe('Summary of rag');
    });

    it('creates directories automatically', async () => {
      const note = createTestNote('deep/nested');
      await storage.saveNote(note);
      const loaded = await storage.loadNote('deep/nested');
      expect(loaded.id).toBe('deep/nested');
    });

    it('throws on missing note', async () => {
      await expect(storage.loadNote('nonexistent')).rejects.toThrow();
    });
  });

  describe('listNotes', () => {
    it('returns empty array when no notes', async () => {
      const notes = await storage.listNotes();
      expect(notes).toEqual([]);
    });

    it('lists all notes', async () => {
      await storage.saveNote(createTestNote('rag'));
      await storage.saveNote(createTestNote('llm'));
      const notes = await storage.listNotes();
      expect(notes).toHaveLength(2);
      expect(notes.map(n => n.id).sort()).toEqual(['llm', 'rag']);
    });

    it('skips corrupted files with warning', async () => {
      await storage.saveNote(createTestNote('good'));
      // Write a corrupted file
      writeFileSync(join(tmpDir, 'notes', 'bad.md'), 'not valid markdown');

      const warnLogs: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnLogs.push(args.join(' '));

      const notes = await storage.listNotes();
      console.warn = originalWarn;

      expect(notes).toHaveLength(1);
      expect(notes[0].id).toBe('good');
      expect(warnLogs.length).toBeGreaterThan(0);
      expect(warnLogs[0]).toContain('bad');
    });
  });

  describe('deleteNote', () => {
    it('moves to archive instead of deleting', async () => {
      await storage.saveNote(createTestNote('rag'));
      await storage.deleteNote('rag');

      await expect(storage.loadNote('rag')).rejects.toThrow();

      const archiveDir = join(tmpDir, 'archive');
      const archived = await import('fs/promises').then(m => m.readdir(archiveDir));
      expect(archived.some(f => f.startsWith('rag-'))).toBe(true);
    });
  });

  // ===== Inbox =====

  describe('writeInbox / listInbox', () => {
    it('writes and lists inbox entries', async () => {
      const entry: InboxEntry = {
        sourceType: 'web',
        title: 'Test Article',
        content: '# Test\nSome content',
        rawMetadata: { url: 'https://example.com' },
      };

      await storage.writeInbox(entry);
      expect(entry.filePath).toBeDefined();

      const entries = await storage.listInbox();
      expect(entries).toHaveLength(1);
      expect(entries[0].title).toBe('Test Article');
      expect(entries[0].sourceType).toBe('web');
      expect(entries[0].content).toBe('# Test\nSome content');
    });

    it('handles empty inbox', async () => {
      const entries = await storage.listInbox();
      expect(entries).toEqual([]);
    });

    it('skips corrupted inbox files', async () => {
      await storage.writeInbox({ sourceType: 'text', title: 'Good', content: 'ok', rawMetadata: {} });
      // Write a file with malformed YAML frontmatter to trigger parse error
      writeFileSync(join(tmpDir, 'inbox', 'bad.md'), '---\nbad: [unclosed\n---\n\ncontent');

      const warnLogs: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnLogs.push(args.join(' '));

      const entries = await storage.listInbox();
      console.warn = originalWarn;

      expect(entries).toHaveLength(1);
      expect(warnLogs.some(l => l.includes('bad'))).toBe(true);
    });

    it('sorts inbox entries by extractedAt descending (newest first)', async () => {
      await storage.writeInbox({ sourceType: 'text', title: 'Old', content: 'old', rawMetadata: { extracted_at: '2025-01-01T00:00:00.000Z' } });
      await storage.writeInbox({ sourceType: 'text', title: 'Middle', content: 'mid', rawMetadata: { extracted_at: '2025-06-01T00:00:00.000Z' } });
      await storage.writeInbox({ sourceType: 'text', title: 'New', content: 'new', rawMetadata: { extracted_at: '2025-12-01T00:00:00.000Z' } });

      const entries = await storage.listInbox();
      expect(entries.map(e => e.title)).toEqual(['New', 'Middle', 'Old']);
    });

    it('falls back to filename timestamp when extractedAt is missing', async () => {
      // Manually write files with specific timestamps in filename
      mkdirSync(join(tmpDir, 'inbox'), { recursive: true });
      writeFileSync(join(tmpDir, 'inbox', '1000000000-old.md'), '---\nsource_type: text\ntitle: Old Fallback\n---\n\nold');
      writeFileSync(join(tmpDir, 'inbox', '2000000000-new.md'), '---\nsource_type: text\ntitle: New Fallback\n---\n\nnew');

      const entries = await storage.listInbox();
      expect(entries.map(e => e.title)).toEqual(['New Fallback', 'Old Fallback']);
    });
  });

  describe('archiveInbox', () => {
    it('moves inbox file to archive', async () => {
      const entry: InboxEntry = {
        sourceType: 'text',
        title: 'To Archive',
        content: 'content',
        rawMetadata: {},
      };
      await storage.writeInbox(entry);
      const fileName = entry.filePath!.split('/').pop()!;

      await storage.archiveInbox(fileName);

      const inboxEntries = await storage.listInbox();
      expect(inboxEntries).toHaveLength(0);
    });
  });

  // ===== Meta: Index =====

  describe('saveIndex / loadIndex', () => {
    it('round-trips inverted index', async () => {
      const index: InvertedIndex = {
        entries: [
          { tag: 'ai', noteId: 'llm', noteTitle: 'LLM', noteSummary: '大语言模型' },
          { tag: 'ai', noteId: 'rag', noteTitle: 'RAG', noteSummary: '' },
        ],
      };

      await storage.saveIndex(index);
      const loaded = await storage.loadIndex();
      expect(loaded.entries).toHaveLength(2);
      expect(loaded.entries[0].tag).toBe('ai');
    });

    it('returns empty index when file missing', async () => {
      const loaded = await storage.loadIndex();
      expect(loaded.entries).toEqual([]);
    });
  });

  // ===== Meta: Aliases =====

  describe('saveAliases / loadAliases', () => {
    it('round-trips aliases', async () => {
      const aliases: AliasMapping[] = [
        { canonical: 'rag', aliases: ['检索增强', 'RAG'] },
      ];

      await storage.saveAliases(aliases);
      const loaded = await storage.loadAliases();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].canonical).toBe('rag');
      expect(loaded[0].aliases).toEqual(['检索增强', 'RAG']);
    });

    it('returns empty aliases when file missing', async () => {
      const loaded = await storage.loadAliases();
      expect(loaded).toEqual([]);
    });
  });

  // ===== Git =====

  describe('archiveInbox', () => {
    it('moves inbox file to archive/inbox/', async () => {
      const entry: InboxEntry = { sourceType: 'text', title: 'Archive Me', content: 'c', rawMetadata: {} };
      await storage.writeInbox(entry);
      const fileName = entry.filePath!.split('/').pop()!;

      await storage.archiveInbox(fileName);
      expect((await storage.listInbox()).length).toBe(0);
    });
  });

  // ===== Conversation =====

  describe('Conversation CRUD', () => {
    it('saves and loads a conversation', async () => {
      const conv: Conversation = {
        date: '2024-10-25',
        topics: ['rag'],
        status: 'open',
        turns: [
          { role: 'user', content: 'What is RAG?' },
          { role: 'agent', content: 'Retrieval Augmented Generation.' },
        ],
        agentActions: [],
      };

      await storage.saveConversation(conv);
      const loaded = await storage.loadConversation('2024-10-25');
      expect(loaded.date).toBe('2024-10-25');
      expect(loaded.turns).toHaveLength(2);
      expect(loaded.turns[0].content).toBe('What is RAG?');
    });

    it('lists conversations sorted by date', async () => {
      await storage.saveConversation({
        date: '2024-10-26',
        topics: [],
        status: 'open',
        turns: [],
        agentActions: [],
      });
      await storage.saveConversation({
        date: '2024-10-25',
        topics: [],
        status: 'open',
        turns: [],
        agentActions: [],
      });

      const convs = await storage.listConversations();
      expect(convs.map(c => c.date)).toEqual(['2024-10-25', '2024-10-26']);
    });

    it('returns empty array when no conversations', async () => {
      expect(await storage.listConversations()).toEqual([]);
    });

    it('skips corrupted conversation files', async () => {
      await storage.saveConversation({
        date: '2024-10-25',
        topics: [],
        status: 'open',
        turns: [],
        agentActions: [],
      });
      // Malformed YAML to trigger parse error
      writeFileSync(join(tmpDir, 'conversations', 'bad.md'), '---\nbad: [unclosed\n---\n\nbody');

      const warnLogs: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnLogs.push(args.join(' '));

      const convs = await storage.listConversations();
      console.warn = originalWarn;

      expect(convs).toHaveLength(1);
      expect(warnLogs.some(l => l.includes('bad'))).toBe(true);
    });
  });

  // ===== Git =====

  describe('commit', () => {
    it('executes git add and commit', async () => {
      const mockExecFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
      const gitStorage = new FileSystemStorage(tmpDir, mockExecFile as any);

      await gitStorage.commit('[test] note update');
      expect(mockExecFile).toHaveBeenCalledTimes(2);
      const [file1, args1, opts1] = mockExecFile.mock.calls[0];
      expect(file1).toBe('git');
      expect(args1).toContain('add');
      expect(opts1).toHaveProperty('cwd');

      const [file2, args2] = mockExecFile.mock.calls[1];
      expect(file2).toBe('git');
      expect(args2).toContain('commit');
      expect(args2).toContain('[test] note update');
    });

    it('ignores nothing-to-commit stderr', async () => {
      const err = new Error('nothing to commit, working tree clean');
      (err as any).stderr = 'nothing to commit, working tree clean';
      const mockExecFile = vi.fn()
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockRejectedValueOnce(err);
      const gitStorage = new FileSystemStorage(tmpDir, mockExecFile as any);

      await gitStorage.commit('[test] empty commit');
      expect(mockExecFile).toHaveBeenCalledTimes(2);
    });

    it('warns on unexpected git stderr', async () => {
      const mockExecFile = vi.fn()
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: 'some warning' });
      const gitStorage = new FileSystemStorage(tmpDir, mockExecFile as any);

      const warnLogs: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnLogs.push(args.join(' '));

      await gitStorage.commit('[test] with warning');
      console.warn = originalWarn;

      expect(warnLogs.some(l => l.includes('some warning'))).toBe(true);
    });
  });
});
