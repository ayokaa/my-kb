import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/queue', () => ({
  enqueue: vi.fn().mockReturnValue('task-mock-123'),
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
  });
});
