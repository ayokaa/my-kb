import { describe, it, expect, vi } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/search/engine', () => ({
  contentFallback: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function () {
    return {
      listNotes: vi.fn().mockResolvedValue([
        {
          id: 'note-1',
          title: 'Test Note',
          tags: ['test'],
          status: 'seed',
          created: '2024-01-01T00:00:00Z',
          updated: '2024-01-01T00:00:00Z',
          sources: [],
          summary: 'A test summary',
          personalContext: '',
          keyFacts: [],
          timeline: [],
          links: [],
          qas: [],
          content: 'Full text content for search testing',
        },
      ]),
      getRoot: vi.fn().mockReturnValue('knowledge-test'),
    };
  }),
}));

function mockReq(search?: string) {
  const url = search
    ? `http://localhost/api/notes?search=${encodeURIComponent(search)}`
    : 'http://localhost/api/notes';
  return new Request(url);
}

describe('/api/notes', () => {
  it('returns notes list', async () => {
    const res = await GET(mockReq());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.notes).toHaveLength(1);
    expect(data.notes[0].title).toBe('Test Note');
  });

  it('supports full-text search via query param', async () => {
    const res = await GET(mockReq('search testing'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.notes)).toBe(true);
  });

  it('returns empty array when search is empty string', async () => {
    const res = await GET(mockReq(''));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.notes).toHaveLength(1);
  });
});
