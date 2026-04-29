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

  it('passes userHint to text ingest task', async () => {
    const { enqueue } = await import('@/lib/queue');
    (enqueue as any).mockClear();

    const req = new Request('http://localhost/api/ingest', {
      method: 'POST',
      body: JSON.stringify({ type: 'text', title: 'Test', content: 'Content', hint: 'Focus on architecture' }),
    });

    await POST(req);
    expect(enqueue).toHaveBeenCalledWith(
      'ingest',
      expect.objectContaining({ userHint: 'Focus on architecture' })
    );
  });

  it('omits userHint when not provided', async () => {
    const { enqueue } = await import('@/lib/queue');
    (enqueue as any).mockClear();

    const req = new Request('http://localhost/api/ingest', {
      method: 'POST',
      body: JSON.stringify({ type: 'text', title: 'No Hint', content: 'Content' }),
    });

    await POST(req);
    expect(enqueue).toHaveBeenCalledWith(
      'ingest',
      expect.objectContaining({ userHint: undefined })
    );
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
