import { schedule, type ScheduledTask } from 'node-cron';
import { enqueue } from '@/lib/queue';
import { logger } from '@/lib/logger';

let task: ScheduledTask | null = null;
let isRunning = false;

export function startRelinkCron(cronExpr = '0 3 * * *') {
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
  });

    logger.info('Relink', `Started, scheduled daily at ${cronExpr}`);
}

export function stopRelinkCron() {
  if (task) {
    task.stop();
    task.destroy();
    task = null;
    logger.info('Relink', 'Stopped');
  }
}

export function restartRelinkCron(cronExpr: string) {
  stopRelinkCron();
  startRelinkCron(cronExpr);
}
