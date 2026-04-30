import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTasks } from 'node-cron';

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
  return Array.from(getTasks().values()).filter((t: any) => t.name === 'relink-cron').length;
}

describe('HMR globalThis protection for relink (real node-cron)', () => {
  afterEach(async () => {
    const mod = await loadCron();
    mod.stopRelinkCron();
    Array.from(getTasks().values()).forEach((t: any) => {
      if (t.name === 'relink-cron') {
        try { t.destroy(); } catch {}
      }
    });
    delete (globalThis as any).__my_kb_relink_cron_task__;
  });

  it('destroys previous task via globalThis when module is reloaded', async () => {
    const mod1 = await loadCron();
    mod1.startRelinkCron('0 3 * * *');

    const task1 = (globalThis as any).__my_kb_relink_cron_task__;
    expect(task1.getStatus()).not.toBe('destroyed');

    vi.resetModules();
    const mod2 = await loadCron();
    mod2.startRelinkCron('0 3 * * *');

    const task2 = (globalThis as any).__my_kb_relink_cron_task__;
    expect(task2).not.toBe(task1);
    expect(task1.getStatus()).toBe('destroyed');
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
      expect(tasks[i].getStatus()).toBe('destroyed');
    }
    expect(tasks[4].getStatus()).not.toBe('destroyed');
    expect(countRelinkTasks()).toBe(1);
  });
});
