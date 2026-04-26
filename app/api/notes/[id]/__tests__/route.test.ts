import { describe, it, expect, vi } from 'vitest';
import { GET } from '../route';

const mockLoadNote = vi.fn();

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function () {
    return {
      loadNote: mockLoadNote,
    };
  }),
}));

describe('/api/notes/[id]', () => {
  it('returns a note', async () => {
    mockLoadNote.mockResolvedValue({
      id: 'note-1',
      title: 'Test Note',
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
      qas: [],
      content: '',
    });

    const req = new Request('http://localhost/api/notes/note-1');
    const res = await GET(req, { params: Promise.resolve({ id: 'note-1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.note.id).toBe('note-1');
  });

  it('returns 404 for missing note', async () => {
    mockLoadNote.mockRejectedValue(new Error('Not found'));

    const req = new Request('http://localhost/api/notes/missing');
    const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });
});
