import { describe, it, expect, vi } from 'vitest';
import { GET, POST, DELETE } from '../route';

const mockList = vi.hoisted(() => vi.fn());
const mockAdd = vi.hoisted(() => vi.fn());
const mockRemove = vi.hoisted(() => vi.fn());

vi.mock('@/lib/rss/manager', () => ({
  listSubscriptions: mockList,
  addSubscription: mockAdd,
  removeSubscription: mockRemove,
}));

describe('/api/rss/subscriptions', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockAdd.mockReset();
    mockRemove.mockReset();
  });

  describe('GET', () => {
    it('returns subscriptions list', async () => {
      mockList.mockResolvedValue([
        { url: 'https://example.com/feed.xml', name: 'Test Feed', addedAt: '2024-01-01' },
      ]);
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.subscriptions).toHaveLength(1);
      expect(data.subscriptions[0].name).toBe('Test Feed');
    });

    it('returns 500 on internal error', async () => {
      mockList.mockRejectedValue(new Error('disk error'));
      const res = await GET();
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Internal error');
    });
  });

  describe('POST', () => {
    it('adds a subscription', async () => {
      mockAdd.mockResolvedValue({
        url: 'https://example.com/feed.xml',
        name: 'Test Feed',
        addedAt: '2024-01-01',
      });
      const req = new Request('http://localhost/api/rss/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/feed.xml', name: 'Test Feed' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.subscription.name).toBe('Test Feed');
    });

    it('returns 400 when URL is missing', async () => {
      const req = new Request('http://localhost/api/rss/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid URL', async () => {
      const req = new Request('http://localhost/api/rss/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ url: 'not-a-url' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for non-HTTP URL', async () => {
      const req = new Request('http://localhost/api/rss/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ url: 'file:///etc/passwd' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when add fails', async () => {
      mockAdd.mockRejectedValue(new Error('duplicate'));
      const req = new Request('http://localhost/api/rss/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/feed.xml' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON', async () => {
      const req = new Request('http://localhost/api/rss/subscriptions', {
        method: 'POST',
        body: 'not json',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE', () => {
    it('removes a subscription', async () => {
      mockRemove.mockResolvedValue(undefined);
      const req = new Request('http://localhost/api/rss/subscriptions', {
        method: 'DELETE',
        body: JSON.stringify({ url: 'https://example.com/feed.xml' }),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(mockRemove).toHaveBeenCalledWith('https://example.com/feed.xml');
    });

    it('returns 400 when URL is missing', async () => {
      const req = new Request('http://localhost/api/rss/subscriptions', {
        method: 'DELETE',
        body: JSON.stringify({}),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });

    it('returns 404 when subscription not found', async () => {
      mockRemove.mockRejectedValue(new Error('not found'));
      const req = new Request('http://localhost/api/rss/subscriptions', {
        method: 'DELETE',
        body: JSON.stringify({ url: 'https://example.com/feed.xml' }),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid JSON', async () => {
      const req = new Request('http://localhost/api/rss/subscriptions', {
        method: 'DELETE',
        body: 'not json',
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });
  });
});
