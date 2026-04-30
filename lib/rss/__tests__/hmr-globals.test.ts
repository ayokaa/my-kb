import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTasks } from 'node-cron';

// Only mock dependencies; keep real node-cron to test setTimeout behavior
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
  return Array.from(getTasks().values()).filter((t: any) => t.name === 'rss-cron').length;
}

describe('HMR globalThis protection (real node-cron)', () => {
  afterEach(async () => {
    const mod = await loadCron();
    mod.stopRSSCron();
    // Also force-destroy anything left in registry
    Array.from(getTasks().values()).forEach((t: any) => {
      if (t.name === 'rss-cron') {
        try { t.destroy(); } catch {}
      }
    });
    delete (globalThis as any).__my_kb_rss_cron_task__;
  });

  it('stores task in globalThis on start', async () => {
    const mod = await loadCron();
    mod.startRSSCron(60);

    const stored = (globalThis as any).__my_kb_rss_cron_task__;
    expect(stored).not.toBeNull();
    expect(stored.getStatus()).not.toBe('destroyed');
    expect(countRssTasks()).toBe(1);
  });

  it('destroys previous task via globalThis when module is reloaded', async () => {
    // First module load
    const mod1 = await loadCron();
    mod1.startRSSCron(60);

    const task1 = (globalThis as any).__my_kb_rss_cron_task__;
    expect(task1.getStatus()).not.toBe('destroyed');

    // Simulate HMR: reset modules and re-import
    vi.resetModules();
    const mod2 = await loadCron();

    // Second start should destroy task1 via globalThis
    mod2.startRSSCron(60);

    const task2 = (globalThis as any).__my_kb_rss_cron_task__;
    expect(task2).not.toBe(task1);
    expect(task1.getStatus()).toBe('destroyed');
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

    // All previous tasks should be destroyed; only the last one lives
    for (let i = 0; i < 4; i++) {
      expect(tasks[i].getStatus()).toBe('destroyed');
    }
    expect(tasks[4].getStatus()).not.toBe('destroyed');
    expect(countRssTasks()).toBe(1);
  });

  it('stopRSSCron cleans both module-level and globalThis references', async () => {
    const mod = await loadCron();
    mod.startRSSCron(60);

    const task = (globalThis as any).__my_kb_rss_cron_task__;
    expect(task.getStatus()).not.toBe('destroyed');

    mod.stopRSSCron();

    expect(task.getStatus()).toBe('destroyed');
    expect((globalThis as any).__my_kb_rss_cron_task__).toBeNull();
    expect(countRssTasks()).toBe(0);
  });
});
