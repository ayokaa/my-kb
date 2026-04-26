import { describe, it, expect, vi } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function() {
    return {
      listInbox: vi.fn().mockResolvedValue([
        { title: 'Test Article', content: 'Hello world', sourceType: 'web', rawMetadata: {}, filePath: '/knowledge/inbox/1-test.md' },
      ]),
    };
  }),
}));

vi.mock('@/lib/queue', () => ({
  listPending: vi.fn().mockReturnValue([]),
}));

describe('/api/inbox', () => {
  it('returns inbox entries', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].title).toBe('Test Article');
  });
});
