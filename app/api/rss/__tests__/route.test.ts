import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/ingestion/rss', () => ({
  fetchRSS: vi.fn().mockResolvedValue([
    { title: 'Article 1', link: 'https://example.com/1', pubDate: '2024-01-01', description: 'Desc 1' },
    { title: 'Article 2', link: 'https://example.com/2', pubDate: '2024-01-02', description: 'Desc 2' },
  ]),
}));

vi.mock('@/lib/rss/manager', () => ({
  ingestRSSItems: vi.fn().mockResolvedValue([
    { title: 'Article 1', link: 'https://example.com/1' },
    { title: 'Article 2', link: 'https://example.com/2' },
  ]),
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

  it('fetches RSS and returns ingested entries', async () => {
    const req = new Request('http://localhost/api/rss', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/rss.xml', name: 'Test Blog', maxItems: 2 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.count).toBe(2);
  });
});
