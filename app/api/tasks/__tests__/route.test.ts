import { describe, it, expect, vi } from 'vitest';
import { GET, POST } from '../route';

const mockRetryTask = vi.hoisted(() => vi.fn());

vi.mock('@/lib/queue', () => ({
  listTasks: vi.fn().mockReturnValue([
    { id: 'task-1', type: 'ingest', status: 'done', createdAt: '2024-01-01T00:00:00Z' },
  ]),
  listPending: vi.fn().mockReturnValue([
    { id: 'task-2', type: 'ingest', status: 'pending', createdAt: '2024-01-02T00:00:00Z' },
  ]),
  listInboxPending: vi.fn().mockReturnValue([
    { id: 'task-2', type: 'ingest', status: 'pending', createdAt: '2024-01-02T00:00:00Z' },
  ]),
  retryTask: mockRetryTask,
}));

describe('/api/tasks', () => {
  it('returns all tasks', async () => {
    const req = new Request('http://localhost/api/tasks');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].id).toBe('task-1');
  });

  it('filters pending tasks', async () => {
    const req = new Request('http://localhost/api/tasks?filter=pending');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].status).toBe('pending');
  });

  it('filters inbox_pending tasks excluding rss_fetch', async () => {
    const req = new Request('http://localhost/api/tasks?filter=inbox_pending');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].type).toBe('ingest');
  });

  describe('POST /api/tasks', () => {
    it('retries a failed task', async () => {
      mockRetryTask.mockReturnValue({ id: 'task-3', status: 'pending', type: 'ingest' });
      const req = new Request('http://localhost/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ action: 'retry', taskId: 'task-3' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.task.status).toBe('pending');
      expect(mockRetryTask).toHaveBeenCalledWith('task-3');
    });

    it('returns 400 when task is not found or not failed', async () => {
      mockRetryTask.mockReturnValue(null);
      const req = new Request('http://localhost/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ action: 'retry', taskId: 'task-missing' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('not found');
    });

    it('returns 400 for invalid action', async () => {
      const req = new Request('http://localhost/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ action: 'unknown', taskId: 'task-1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });
});
