import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node-cron before importing cron.ts
const scheduledTasks: Array<{ expression: string; callback: () => Promise<void>; task: any }> = [];
const mockRegistry = new Map<string, any>();

function createMockTask(name?: string) {
  const task: any = { stop: vi.fn(), name };
  task.destroy = vi.fn(() => {
    for (const [key, value] of mockRegistry.entries()) {
      if (value === task) {
        mockRegistry.delete(key);
        break;
      }
    }
  });
  mockRegistry.set(String(mockRegistry.size), task);
  return task;
}

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((expression: string, callback: () => Promise<void>, options?: any) => {
      const task = createMockTask(options?.name);
      scheduledTasks.push({ expression, callback, task });
      return task;
    }),
    getTasks: vi.fn(() => mockRegistry),
  },
  schedule: vi.fn((expression: string, callback: () => Promise<void>, options?: any) => {
    const task = createMockTask(options?.name);
    scheduledTasks.push({ expression, callback, task });
    return task;
  }),
  getTasks: vi.fn(() => mockRegistry),
}));

vi.mock('../manager', () => ({
  listSubscriptions: vi.fn().mockResolvedValue([
    { url: 'https://example.com/feed.xml', name: 'Test Feed' },
  ]),
}));

vi.mock('@/lib/queue', () => ({
  enqueue: vi.fn(),
}));

describe('startRSSCron', () => {
  beforeEach(async () => {
    scheduledTasks.length = 0;
    mockRegistry.clear();
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function loadCron() {
    const mod = await import('../cron');
    return mod;
  }

  it('schedules a cron job with the correct interval', async () => {
    const { startRSSCron } = await loadCron();
    startRSSCron(30);
    expect(scheduledTasks).toHaveLength(1);
    expect(scheduledTasks[0].expression).toBe('*/30 * * * *');
  });

  it('enqueues feed checks on tick', async () => {
    const { startRSSCron } = await loadCron();
    const { enqueue } = await import('@/lib/queue');
    const { listSubscriptions } = await import('../manager');

    startRSSCron(60);
    const callback = scheduledTasks[0].callback;
    await callback();
    expect(listSubscriptions).toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith('rss_fetch', {
      url: 'https://example.com/feed.xml',
      name: 'Test Feed',
      isSubscriptionCheck: true,
    });
  });

  it('skips tick when previous check is still running', async () => {
    const { startRSSCron } = await loadCron();
    const { listSubscriptions } = await import('../manager');

    startRSSCron(60);
    const callback = scheduledTasks[0].callback;

    // Make listSubscriptions slow so the first tick stays "running"
    let resolveList: (value: any) => void;
    (listSubscriptions as any).mockImplementation(() => new Promise((resolve) => { resolveList = resolve; }));

    const firstTick = callback();
    // Immediately trigger second tick while first is still pending
    await callback();

    // Second tick should not have called listSubscriptions again (it's skipped)
    expect(listSubscriptions).toHaveBeenCalledTimes(1);

    // Clean up
    resolveList!([{ url: 'https://example.com/feed.xml', name: 'Test Feed' }]);
    await firstTick;
  });

  it('replaces previous cron task on repeated calls', async () => {
    const { startRSSCron } = await loadCron();
    startRSSCron(60);
    const firstTask = scheduledTasks[0].task;
    startRSSCron(60);
    expect(firstTask.stop).toHaveBeenCalled();
    expect(firstTask.destroy).toHaveBeenCalled();
    expect(scheduledTasks).toHaveLength(2);
  });

  it('destroys orphaned tasks from previous module loads (HMR leak prevention)', async () => {
    // First module load
    const mod1 = await loadCron();
    mod1.startRSSCron(60);
    const firstTask = scheduledTasks[0].task;

    // Simulate HMR: reset modules and re-import
    vi.resetModules();
    const mod2 = await loadCron();

    // After HMR, the module-level 'task' variable is reset to null,
    // but getTasks() still returns the old task from the global registry.
    // startRSSCron should destroy it before creating a new one.
    mod2.startRSSCron(60);

    expect(firstTask.destroy).toHaveBeenCalled();
    expect(scheduledTasks).toHaveLength(2);
  });
});
