import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function () {
    return {
      archiveInbox: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

describe('/api/inbox/archive', () => {
  it('returns 400 when no fileName', async () => {
    const req = new Request('http://localhost/api/inbox/archive', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('archives inbox file', async () => {
    const req = new Request('http://localhost/api/inbox/archive', {
      method: 'POST',
      body: JSON.stringify({ fileName: '123-test.md' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.message).toBe('已归档');
  });
});
