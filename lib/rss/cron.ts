import { schedule, getTasks, type ScheduledTask } from 'node-cron';
import { listSubscriptions } from './manager';
import { enqueue } from '@/lib/queue';
import { logger } from '@/lib/logger';

const RSS_CRON_KEY = '__my_kb_rss_cron_task__';

let task: ScheduledTask | null = null;
let isRunning = false;

function getStoredTask(): ScheduledTask | null {
  return ((globalThis as Record<string, unknown>)[RSS_CRON_KEY] as ScheduledTask | null) ?? null;
}

function storeTask(t: ScheduledTask | null): void {
  (globalThis as Record<string, unknown>)[RSS_CRON_KEY] = t;
}

function buildCronExpr(intervalMinutes: number): string {
  const n = Math.max(1, intervalMinutes);
  return n >= 60 ? '0 * * * *' : `*/${n} * * * *`;
}

export function startRSSCron(intervalMinutes = 60) {
  // Destroy task from previous module instance (survives HMR via globalThis)
  const stored = getStoredTask();
  if (stored) {
    try { stored.stop(); } catch {}
    try { stored.destroy(); } catch {}
    storeTask(null);
  }

  // Also clean up node-cron global registry
  getTasks().forEach((t) => {
    if (t.name === 'rss-cron') {
      try { t.destroy(); } catch {}
    }
  });

  if (task) {
    task.stop();
    task.destroy();
  }

  const cronExpr = buildCronExpr(intervalMinutes);

  task = schedule(cronExpr, async () => {
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
  }, { name: 'rss-cron' });

  storeTask(task);
  logger.info('RSS', `Started, checking every ${intervalMinutes} minutes (${cronExpr})`);
}

export function stopRSSCron() {
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
  logger.info('RSS', 'Stopped');
}

export function restartRSSCron(intervalMinutes: number) {
  stopRSSCron();
  startRSSCron(intervalMinutes);
}
