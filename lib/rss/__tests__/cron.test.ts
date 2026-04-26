import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node-cron before importing cron.ts
const scheduledTasks: Array<{ expression: string; callback: () => Promise<void> }> = [];

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((expression: string, callback: () => Promise<void>) => {
      scheduledTasks.push({ expression, callback });
    }),
  },
  schedule: vi.fn((expression: string, callback: () => Promise<void>) => {
    scheduledTasks.push({ expression, callback });
  }),
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

  it('does not start multiple cron jobs on repeated calls', async () => {
    const { startRSSCron } = await loadCron();
    startRSSCron(60);
    startRSSCron(60);
    startRSSCron(60);
    expect(scheduledTasks).toHaveLength(1);
  });
});
