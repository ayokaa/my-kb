import cron from 'node-cron';
import { enqueue } from '@/lib/queue';

let task: cron.ScheduledTask | null = null;
let isRunning = false;

export function startRelinkCron(cronExpr = '0 3 * * *') {
  if (task) {
    task.stop();
    task.destroy();
  }

  task = cron.schedule(cronExpr, async () => {
    if (isRunning) {
      console.log('[Relink Cron] Previous job still running, skipping this tick');
      return;
    }
    isRunning = true;
    console.log(`[Relink Cron] Enqueuing relink job at ${new Date().toISOString()}`);
    try {
      await Promise.resolve(enqueue('relink', {}));
      console.log('[Relink Cron] Relink job enqueued');
    } catch (err) {
      console.error('[Relink Cron] Error:', err);
    } finally {
      isRunning = false;
    }
  });

  console.log(`[Relink Cron] Started, scheduled daily at ${cronExpr}`);
}

export function stopRelinkCron() {
  if (task) {
    task.stop();
    task.destroy();
    task = null;
    console.log('[Relink Cron] Stopped');
  }
}

export function restartRelinkCron(cronExpr: string) {
  stopRelinkCron();
  startRelinkCron(cronExpr);
}
