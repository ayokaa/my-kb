import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

const mockEnqueue = vi.hoisted(() => vi.fn());
const mockListSubs = vi.hoisted(() => vi.fn());

vi.mock('@/lib/queue', () => ({
  enqueue: mockEnqueue,
}));

vi.mock('@/lib/rss/manager', () => ({
  listSubscriptions: mockListSubs,
}));

describe('/api/rss/subscriptions/check', () => {
  beforeEach(() => {
    mockEnqueue.mockReset().mockReturnValue('task-check-123');
    mockListSubs.mockReset();
  });

  it('queues check for a specific subscription', async () => {
    const req = new Request('http://localhost/api/rss/subscriptions/check', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/feed.xml' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.queued).toBe(1);
    expect(data.taskIds).toEqual(['task-check-123']);
    expect(mockEnqueue).toHaveBeenCalledWith('rss_fetch', {
      url: 'https://example.com/feed.xml',
      isSubscriptionCheck: true,
    });
  });

  it('queues check for all subscriptions when no URL', async () => {
    mockListSubs.mockResolvedValue([
      { url: 'https://a.com/feed.xml', name: 'A' },
      { url: 'https://b.com/feed.xml', name: 'B' },
    ]);
    const req = new Request('http://localhost/api/rss/subscriptions/check', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.queued).toBe(2);
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
  });

  it('returns 0 queued when no subscriptions', async () => {
    mockListSubs.mockResolvedValue([]);
    const req = new Request('http://localhost/api/rss/subscriptions/check', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.queued).toBe(0);
  });

  it('returns 500 on error', async () => {
    mockListSubs.mockRejectedValue(new Error('disk error'));
    const req = new Request('http://localhost/api/rss/subscriptions/check', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
