import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../route';

const mockImportOPML = vi.hoisted(() => vi.fn());

vi.mock('@/lib/rss/manager', () => ({
  importOPML: mockImportOPML,
}));

describe('/api/rss/subscriptions/import-opml', () => {
  beforeEach(() => {
    mockImportOPML.mockReset();
  });

  it('imports OPML successfully', async () => {
    mockImportOPML.mockResolvedValue({ added: 3, errors: [] });
    const req = new Request('http://localhost/api/rss/subscriptions/import-opml', {
      method: 'POST',
      body: JSON.stringify({ xml: '<opml><body><outline text="Test" xmlUrl="https://example.com/feed.xml"/></body></opml>' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.added).toBe(3);
    expect(data.errors).toEqual([]);
  });

  it('returns 400 when XML is missing', async () => {
    const req = new Request('http://localhost/api/rss/subscriptions/import-opml', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('OPML XML required');
  });

  it('returns 500 when import fails', async () => {
    mockImportOPML.mockRejectedValue(new Error('parse error'));
    const req = new Request('http://localhost/api/rss/subscriptions/import-opml', {
      method: 'POST',
      body: JSON.stringify({ xml: 'invalid' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('parse error');
  });

  it('returns partial success with errors', async () => {
    mockImportOPML.mockResolvedValue({ added: 1, errors: ['Invalid URL: not-a-url'] });
    const req = new Request('http://localhost/api/rss/subscriptions/import-opml', {
      method: 'POST',
      body: JSON.stringify({ xml: '<opml><body><outline xmlUrl="not-a-url"/></body></opml>' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.added).toBe(1);
    expect(data.errors).toContain('Invalid URL: not-a-url');
  });
});
