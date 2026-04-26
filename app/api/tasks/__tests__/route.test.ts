import { describe, it, expect, vi } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/queue', () => ({
  listTasks: vi.fn().mockReturnValue([
    { id: 'task-1', type: 'ingest', status: 'done', createdAt: '2024-01-01T00:00:00Z' },
  ]),
  listPending: vi.fn().mockReturnValue([
    { id: 'task-2', type: 'ingest', status: 'pending', createdAt: '2024-01-02T00:00:00Z' },
  ]),
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
});
