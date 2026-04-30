import { schedule, getTasks, type ScheduledTask } from 'node-cron';
import { enqueue } from '@/lib/queue';
import { logger } from '@/lib/logger';

const RELINK_CRON_KEY = '__my_kb_relink_cron_task__';

let task: ScheduledTask | null = null;
let isRunning = false;

function getStoredTask(): ScheduledTask | null {
  return ((globalThis as Record<string, unknown>)[RELINK_CRON_KEY] as ScheduledTask | null) ?? null;
}

function storeTask(t: ScheduledTask | null): void {
  (globalThis as Record<string, unknown>)[RELINK_CRON_KEY] = t;
}

export function startRelinkCron(cronExpr = '0 3 * * *') {
  // Destroy task from previous module instance (survives HMR via globalThis)
  const stored = getStoredTask();
  if (stored) {
    try { stored.stop(); } catch {}
    try { stored.destroy(); } catch {}
    storeTask(null);
  }

  // Also clean up node-cron global registry
  getTasks().forEach((t) => {
    if (t.name === 'relink-cron') {
      try { t.destroy(); } catch {}
    }
  });

  if (task) {
    task.stop();
    task.destroy();
  }

  task = schedule(cronExpr, async () => {
    if (isRunning) {
      logger.info('Relink', 'Previous job still running, skipping this tick');
      return;
    }
    isRunning = true;
    logger.info('Relink', `Enqueuing relink job at ${new Date().toISOString()}`);
    try {
      await Promise.resolve(enqueue('relink', {}));
      logger.info('Relink', 'Relink job enqueued');
    } catch (err) {
      logger.error('Relink', `Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isRunning = false;
    }
  }, { name: 'relink-cron' });

    storeTask(task);
    logger.info('Relink', `Started, scheduled daily at ${cronExpr}`);
}

export function stopRelinkCron() {
  if (task) {
    task.stop();
    task.destroy();
    task = null;
  }
  const stored = getStoredTask();
  if (stored) {
    try { stored.stop(); } catch {}
    try { stored.destroy(); } catch {}
    storeTask(null);
  }
  logger.info('Relink', 'Stopped');
}

export function restartRelinkCron(cronExpr: string) {
  stopRelinkCron();
  startRelinkCron(cronExpr);
}
