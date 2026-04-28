import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/queue', () => ({
  enqueue: vi.fn().mockReturnValue('task-mock-id'),
}));

describe('/api/ingest', () => {
  it('enqueues text ingest task', async () => {
    const req = new Request('http://localhost/api/ingest', {
      method: 'POST',
      body: JSON.stringify({ type: 'text', title: 'My Note', content: 'Hello world' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.taskId).toBe('task-mock-id');
  });

  it('enqueues link fetch task', async () => {
    const req = new Request('http://localhost/api/ingest', {
      method: 'POST',
      body: JSON.stringify({ type: 'link', url: 'https://example.com' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.taskId).toBe('task-mock-id');
  });

  it('returns 400 for unknown type', async () => {
    const req = new Request('http://localhost/api/ingest', {
      method: 'POST',
      body: JSON.stringify({ type: 'unknown' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
