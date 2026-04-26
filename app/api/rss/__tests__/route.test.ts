import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/queue', () => ({
  enqueue: vi.fn().mockReturnValue('task-test-rss-123'),
}));

describe('/api/rss', () => {
  it('returns 400 when no URL', async () => {
    const req = new Request('http://localhost/api/rss', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-HTTP URL (SSRF protection)', async () => {
    const req = new Request('http://localhost/api/rss', {
      method: 'POST',
      body: JSON.stringify({ url: 'file:///etc/passwd' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid');
  });

  it('returns 400 for invalid URL string', async () => {
    const req = new Request('http://localhost/api/rss', {
      method: 'POST',
      body: JSON.stringify({ url: 'not-a-url' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('queues RSS fetch and returns 202', async () => {
    const req = new Request('http://localhost/api/rss', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/rss.xml', name: 'Test Blog', maxItems: 2 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.taskId).toBe('task-test-rss-123');
    expect(data.message).toContain('queued');
  });
});
