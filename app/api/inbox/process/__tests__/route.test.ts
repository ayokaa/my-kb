import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const inboxDir = join(process.cwd(), 'knowledge', 'inbox');
const notesDir = join(process.cwd(), 'knowledge', 'notes');

vi.mock('@/lib/cognition/ingest', () => ({
  processInboxEntry: vi.fn().mockResolvedValue({
    note: {
      id: 'test-article',
      title: 'Test Article',
      tags: ['test'],
      status: 'seed',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
      sources: ['web'],
      summary: 'A test summary',
      personalContext: '',
      keyFacts: ['Fact 1'],
      timeline: [],
      links: [],
      qas: [],
      content: 'Test content',
    },
  }),
}));

describe('/api/inbox/process', () => {
  it('returns 400 when no fileName', async () => {
    const req = new Request('http://localhost/api/inbox/process', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('processes inbox file and creates note', async () => {
    mkdirSync(inboxDir, { recursive: true });
    mkdirSync(notesDir, { recursive: true });
    const fileName = '123-test-article.md';
    writeFileSync(
      join(inboxDir, fileName),
      '---\nsource_type: web\ntitle: Test Article\nextracted_at: 2024-01-01T00:00:00Z\n---\n\nTest content',
      'utf-8'
    );

    const req = new Request('http://localhost/api/inbox/process', {
      method: 'POST',
      body: JSON.stringify({ fileName }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.note.id).toBe('test-article');

    // cleanup
    rmSync(join(inboxDir, fileName), { force: true });
    rmSync(join(process.cwd(), 'knowledge', 'archive', 'inbox', fileName), { force: true });
  });
});
