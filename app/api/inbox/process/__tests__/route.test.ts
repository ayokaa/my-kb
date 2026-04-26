import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

const mockEnqueue = vi.fn().mockReturnValue('task-mock-123');

vi.mock('@/lib/queue', () => ({
  enqueue: (...args: any[]) => mockEnqueue(...args),
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

  it('enqueues ingest task and returns 202', async () => {
    const req = new Request('http://localhost/api/inbox/process', {
      method: 'POST',
      body: JSON.stringify({ fileName: '123-test-article.md' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.taskId).toBe('task-mock-123');
    expect(data.message).toBe('已加入处理队列');

    expect(mockEnqueue).toHaveBeenCalledWith('ingest', { fileName: '123-test-article.md' });
  });

  it('returns 500 when enqueue fails', async () => {
    mockEnqueue.mockImplementationOnce(() => {
      throw new Error('queue full');
    });

    const req = new Request('http://localhost/api/inbox/process', {
      method: 'POST',
      body: JSON.stringify({ fileName: 'nonexistent.md' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Internal error');
  });
});
