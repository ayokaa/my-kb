import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('@/lib/queue', () => ({
  enqueue: vi.fn(),
}));

describe('startRelinkCron', () => {
  beforeEach(async () => {
    scheduledTasks.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function loadCron() {
    const mod = await import('../cron');
    return mod;
  }

  it('schedules a daily cron job at 03:00', async () => {
    const { startRelinkCron } = await loadCron();
    startRelinkCron();
    expect(scheduledTasks).toHaveLength(1);
    expect(scheduledTasks[0].expression).toBe('0 3 * * *');
  });

  it('enqueues a relink task on tick', async () => {
    const { startRelinkCron } = await loadCron();
    const { enqueue } = await import('@/lib/queue');

    startRelinkCron();
    const callback = scheduledTasks[0].callback;
    await callback();

    expect(enqueue).toHaveBeenCalledWith('relink', {});
  });

  it('skips tick when previous job is still running', async () => {
    const { startRelinkCron } = await loadCron();
    const { enqueue } = await import('@/lib/queue');

    // Make enqueue slow so the first tick stays "running"
    let resolveEnqueue: () => void;
    (enqueue as any).mockImplementation(() => new Promise<void>((resolve) => { resolveEnqueue = resolve; }));

    startRelinkCron();
    const callback = scheduledTasks[0].callback;

    const firstTick = callback();
    await callback(); // second tick while first is pending

    expect(enqueue).toHaveBeenCalledTimes(1);

    resolveEnqueue!();
    await firstTick;
  });

  it('does not start multiple cron jobs on repeated calls', async () => {
    const { startRelinkCron } = await loadCron();
    startRelinkCron();
    startRelinkCron();
    startRelinkCron();
    expect(scheduledTasks).toHaveLength(1);
  });
});
