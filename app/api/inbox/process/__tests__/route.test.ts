import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

const mockArchiveInbox = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/queue', () => ({
  enqueue: vi.fn().mockReturnValue('task-mock-123'),
}));

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function () {
    return {
      archiveInbox: mockArchiveInbox,
    };
  }),
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

  it('archives file before enqueuing and returns 202', async () => {
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

    // Verify archiveInbox was called before enqueue
    expect(mockArchiveInbox).toHaveBeenCalledWith('123-test-article.md');
  });

  it('returns 500 when archiveInbox fails', async () => {
    mockArchiveInbox.mockRejectedValueOnce(new Error('file not found'));

    const req = new Request('http://localhost/api/inbox/process', {
      method: 'POST',
      body: JSON.stringify({ fileName: 'nonexistent.md' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('file not found');
  });
});
