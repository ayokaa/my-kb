import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cron before importing cron.ts
const scheduledTasks: Array<{ expression: string; callback: () => Promise<void>; task: any }> = [];

function createMockTask() {
  const task: any = { stop: vi.fn(), isActive: true };
  return task;
}

vi.mock('cron', () => ({
  CronJob: {
    from: vi.fn((params: any) => {
      const task = createMockTask();
      scheduledTasks.push({ expression: params.cronTime, callback: params.onTick, task });
      return task;
    }),
  },
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
    expect(scheduledTasks).toHaveLength(2);
  });

  it('stops orphaned tasks from previous module loads (HMR leak prevention)', async () => {
    // First module load
    const mod1 = await loadCron();
    mod1.startRSSCron(60);
    const firstTask = scheduledTasks[0].task;

    // Simulate HMR: reset modules and re-import
    vi.resetModules();
    const mod2 = await loadCron();

    // After HMR, the module-level 'task' variable is reset to null,
    // but getStoredTask() still returns the old task from globalThis.
    // startRSSCron should stop it before creating a new one.
    mod2.startRSSCron(60);

    expect(firstTask.stop).toHaveBeenCalled();
    expect(scheduledTasks).toHaveLength(2);
  });
});
