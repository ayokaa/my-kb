import { CronJob } from 'cron';
import { enqueue } from '@/lib/queue';
import { logger } from '@/lib/logger';

const RELINK_CRON_KEY = '__my_kb_relink_cron_task__';

let task: CronJob | null = null;
let isRunning = false;

function getStoredTask(): CronJob | null {
  return ((globalThis as Record<string, unknown>)[RELINK_CRON_KEY] as CronJob | null) ?? null;
}

function storeTask(t: CronJob | null): void {
  (globalThis as Record<string, unknown>)[RELINK_CRON_KEY] = t;
}

export function startRelinkCron(cronExpr = '0 3 * * *') {
  // Stop task from previous module instance (survives HMR via globalThis)
  const stored = getStoredTask();
  if (stored) {
    try { stored.stop(); } catch {}
    storeTask(null);
  }

  if (task) {
    task.stop();
    task = null;
  }

  task = CronJob.from({
    cronTime: cronExpr,
    onTick: async () => {
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
    },
    start: true,
    name: 'relink-cron',
    errorHandler: (err) => {
      logger.error('Relink', `Cron error: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  storeTask(task);
  logger.info('Relink', `Started, scheduled daily at ${cronExpr}`);
}

export function stopRelinkCron() {
  if (task) {
    task.stop();
    task = null;
  }
  const stored = getStoredTask();
  if (stored) {
    try { stored.stop(); } catch {}
    storeTask(null);
  }
  logger.info('Relink', 'Stopped');
}

export function restartRelinkCron(cronExpr: string) {
  stopRelinkCron();
  startRelinkCron(cronExpr);
}
