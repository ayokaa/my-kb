import { describe, it, expect, vi } from 'vitest';
import { GET } from '../route';

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
          content: '',
        },
      ]),
    };
  }),
}));

describe('/api/notes', () => {
  it('returns notes list', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.notes).toHaveLength(1);
    expect(data.notes[0].title).toBe('Test Note');
  });
});
