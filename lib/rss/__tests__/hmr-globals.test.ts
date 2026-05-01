import { describe, it, expect, vi, afterEach } from 'vitest';

// Only mock dependencies; keep real cron to test scheduling behavior
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/queue', () => ({
  enqueue: vi.fn(),
}));

vi.mock('../manager', () => ({
  listSubscriptions: vi.fn().mockResolvedValue([]),
}));

async function loadCron() {
  return import('../cron');
}

function countRssTasks() {
  const stored = (globalThis as any).__my_kb_rss_cron_task__;
  return stored && stored.isActive ? 1 : 0;
}

describe('HMR globalThis protection (real cron)', () => {
  afterEach(async () => {
    const mod = await loadCron();
    mod.stopRSSCron();
    delete (globalThis as any).__my_kb_rss_cron_task__;
  });

  it('stores task in globalThis on start', async () => {
    const mod = await loadCron();
    mod.startRSSCron(60);

    const stored = (globalThis as any).__my_kb_rss_cron_task__;
    expect(stored).not.toBeNull();
    expect(stored.isActive).toBe(true);
    expect(countRssTasks()).toBe(1);
  });

  it('stops previous task via globalThis when module is reloaded', async () => {
    // First module load
    const mod1 = await loadCron();
    mod1.startRSSCron(60);

    const task1 = (globalThis as any).__my_kb_rss_cron_task__;
    expect(task1.isActive).toBe(true);

    // Simulate HMR: reset modules and re-import
    vi.resetModules();
    const mod2 = await loadCron();

    // Second start should stop task1 via globalThis
    mod2.startRSSCron(60);

    const task2 = (globalThis as any).__my_kb_rss_cron_task__;
    expect(task2).not.toBe(task1);
    expect(task1.isActive).toBe(false);
    expect(countRssTasks()).toBe(1);
  });

  it('survives rapid reloads without leaking tasks', async () => {
    const tasks: any[] = [];

    for (let i = 0; i < 5; i++) {
      vi.resetModules();
      const mod = await loadCron();
      mod.startRSSCron(60);
      tasks.push((globalThis as any).__my_kb_rss_cron_task__);
    }

    // All previous tasks should be stopped; only the last one is active
    for (let i = 0; i < 4; i++) {
      expect(tasks[i].isActive).toBe(false);
    }
    expect(tasks[4].isActive).toBe(true);
    expect(countRssTasks()).toBe(1);
  });

  it('stopRSSCron cleans both module-level and globalThis references', async () => {
    const mod = await loadCron();
    mod.startRSSCron(60);

    const task = (globalThis as any).__my_kb_rss_cron_task__;
    expect(task.isActive).toBe(true);

    mod.stopRSSCron();

    expect(task.isActive).toBe(false);
    expect((globalThis as any).__my_kb_rss_cron_task__).toBeNull();
    expect(countRssTasks()).toBe(0);
  });
});
