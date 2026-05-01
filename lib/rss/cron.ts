import { CronJob } from 'cron';
import { listSubscriptions } from './manager';
import { enqueue } from '@/lib/queue';
import { logger } from '@/lib/logger';

const RSS_CRON_KEY = '__my_kb_rss_cron_task__';

let task: CronJob | null = null;
let isRunning = false;

function getStoredTask(): CronJob | null {
  return ((globalThis as Record<string, unknown>)[RSS_CRON_KEY] as CronJob | null) ?? null;
}

function storeTask(t: CronJob | null): void {
  (globalThis as Record<string, unknown>)[RSS_CRON_KEY] = t;
}

function buildCronExpr(intervalMinutes: number): string {
  const n = Math.max(1, intervalMinutes);
  return n >= 60 ? '0 * * * *' : `*/${n} * * * *`;
}

export function startRSSCron(intervalMinutes = 60) {
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

  const cronExpr = buildCronExpr(intervalMinutes);

  task = CronJob.from({
    cronTime: cronExpr,
    onTick: async () => {
      if (isRunning) {
        logger.info('RSS', 'Previous check still running, skipping this tick');
        return;
      }
      isRunning = true;
      logger.info('RSS', `Queuing feed checks at ${new Date().toISOString()}`);
      try {
        const sources = await listSubscriptions();
        for (const source of sources) {
          enqueue('rss_fetch', { url: source.url, name: source.name, isSubscriptionCheck: true });
        }
        logger.info('RSS', `Queued ${sources.length} feed checks`);
      } catch (err) {
        logger.error('RSS', `Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        isRunning = false;
      }
    },
    start: true,
    name: 'rss-cron',
    errorHandler: (err) => {
      logger.error('RSS', `Cron error: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  storeTask(task);
  logger.info('RSS', `Started, checking every ${intervalMinutes} minutes (${cronExpr})`);
}

export function stopRSSCron() {
  if (task) {
    task.stop();
    task = null;
  }
  const stored = getStoredTask();
  if (stored) {
    try { stored.stop(); } catch {}
    storeTask(null);
  }
  logger.info('RSS', 'Stopped');
}

export function restartRSSCron(intervalMinutes: number) {
  stopRSSCron();
  startRSSCron(intervalMinutes);
}
