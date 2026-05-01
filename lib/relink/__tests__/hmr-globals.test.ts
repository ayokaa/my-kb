import { describe, it, expect, vi, afterEach } from 'vitest';

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

async function loadCron() {
  return import('../cron');
}

function countRelinkTasks() {
  const stored = (globalThis as any).__my_kb_relink_cron_task__;
  return stored && stored.isActive ? 1 : 0;
}

describe('HMR globalThis protection for relink (real cron)', () => {
  afterEach(async () => {
    const mod = await loadCron();
    mod.stopRelinkCron();
    delete (globalThis as any).__my_kb_relink_cron_task__;
  });

  it('stops previous task via globalThis when module is reloaded', async () => {
    const mod1 = await loadCron();
    mod1.startRelinkCron('0 3 * * *');

    const task1 = (globalThis as any).__my_kb_relink_cron_task__;
    expect(task1.isActive).toBe(true);

    vi.resetModules();
    const mod2 = await loadCron();
    mod2.startRelinkCron('0 3 * * *');

    const task2 = (globalThis as any).__my_kb_relink_cron_task__;
    expect(task2).not.toBe(task1);
    expect(task1.isActive).toBe(false);
    expect(countRelinkTasks()).toBe(1);
  });

  it('survives rapid reloads without leaking tasks', async () => {
    const tasks: any[] = [];
    for (let i = 0; i < 5; i++) {
      vi.resetModules();
      const mod = await loadCron();
      mod.startRelinkCron('0 3 * * *');
      tasks.push((globalThis as any).__my_kb_relink_cron_task__);
    }
    for (let i = 0; i < 4; i++) {
      expect(tasks[i].isActive).toBe(false);
    }
    expect(tasks[4].isActive).toBe(true);
    expect(countRelinkTasks()).toBe(1);
  });
});
