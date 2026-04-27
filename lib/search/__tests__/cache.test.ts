import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadOrBuildIndex, __resetSearchCache } from '../cache';
import { FileSystemStorage } from '../../storage';
import type { Note } from '../../types';

function makeNote(id: string, title: string): Note {
  return {
    id,
    title,
    tags: [],
    status: 'seed',
    created: '',
    updated: '',
    sources: [],
    summary: '',
    personalContext: '',
    keyFacts: [],
    timeline: [],
    links: [],
    backlinks: [],
    qas: [],
    content: '',
  };
}

describe('loadOrBuildIndex', () => {
  let tmpDir: string;
  let storage: FileSystemStorage;

  beforeEach(() => {
    __resetSearchCache();
    tmpDir = mkdtempSync(join(tmpdir(), 'kb-cache-test-'));
    storage = new FileSystemStorage(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads existing index file', async () => {
    const { serializeIndex } = await import('../inverted-index');
    mkdirSync(join(tmpDir, 'meta'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'meta', 'search-index.json'),
      serializeIndex({ test: [{ noteId: 'n1', field: 'title' }] }, ['n1'])
    );

    const index = await loadOrBuildIndex(storage);
    expect(index['test']).toBeDefined();
  });

  it('reuses provided notes instead of calling listNotes', async () => {
    const listNotesSpy = vi.spyOn(storage, 'listNotes');
    const notes: Note[] = [makeNote('n1', 'Note 1')];

    await loadOrBuildIndex(storage, notes);
    expect(listNotesSpy).not.toHaveBeenCalled();
  });

  it('rebuilds from notes when index file is missing', async () => {
    const notes: Note[] = [makeNote('n1', 'Note 1')];
    const index = await loadOrBuildIndex(storage, notes);
    expect(Object.keys(index).length).toBeGreaterThan(0);
  });

  it('returns cached index on subsequent calls within TTL', async () => {
    const { serializeIndex } = await import('../inverted-index');
    mkdirSync(join(tmpDir, 'meta'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'meta', 'search-index.json'),
      serializeIndex({}, [])
    );

    const index1 = await loadOrBuildIndex(storage);
    const index2 = await loadOrBuildIndex(storage);

    expect(index1).toBe(index2);
  });

  it('deduplicates concurrent requests', async () => {
    const { serializeIndex } = await import('../inverted-index');
    mkdirSync(join(tmpDir, 'meta'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'meta', 'search-index.json'),
      serializeIndex({}, [])
    );

    const [index1, index2] = await Promise.all([
      loadOrBuildIndex(storage),
      loadOrBuildIndex(storage),
    ]);

    expect(index1).toBe(index2);
  });

  it('reloads from file after cache is reset', async () => {
    const { serializeIndex } = await import('../inverted-index');
    mkdirSync(join(tmpDir, 'meta'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'meta', 'search-index.json'),
      serializeIndex({ first: [{ noteId: 'n1', field: 'title' }] }, ['n1'])
    );

    await loadOrBuildIndex(storage);

    // Overwrite file with different content
    writeFileSync(
      join(tmpDir, 'meta', 'search-index.json'),
      serializeIndex({ second: [{ noteId: 'n2', field: 'title' }] }, ['n2'])
    );

    // Without reset, cache would return stale data
    __resetSearchCache();
    const index = await loadOrBuildIndex(storage);
    expect(index['second']).toBeDefined();
  });

  it('recovers from failed index build (loadPromise deadlock)', async () => {
    // First call: make listNotes throw to trigger a build failure
    const listNotesSpy = vi.spyOn(storage, 'listNotes').mockRejectedValue(new Error('disk error'));

    await expect(loadOrBuildIndex(storage)).rejects.toThrow('disk error');

    listNotesSpy.mockRestore();

    // Second call: should succeed, not be permanently blocked by the failed promise
    const notes = [makeNote('n1', 'Recovery Note')];
    const index = await loadOrBuildIndex(storage, notes);
    expect(index).toBeDefined();
    expect(Object.keys(index).length).toBeGreaterThan(0);
  });
});
