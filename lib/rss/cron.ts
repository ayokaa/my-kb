import cron from 'node-cron';
import { listSubscriptions } from './manager';
import { enqueue } from '@/lib/queue';

let task: cron.ScheduledTask | null = null;
let isRunning = false;

function buildCronExpr(intervalMinutes: number): string {
  const n = Math.max(1, intervalMinutes);
  return n >= 60 ? '0 * * * *' : `*/${n} * * * *`;
}

export function startRSSCron(intervalMinutes = 60) {
  if (task) {
    task.stop();
    task.destroy();
  }

  const cronExpr = buildCronExpr(intervalMinutes);

  task = cron.schedule(cronExpr, async () => {
    if (isRunning) {
      console.log('[RSS Cron] Previous check still running, skipping this tick');
      return;
    }
    isRunning = true;
    console.log(`[RSS Cron] Queuing feed checks at ${new Date().toISOString()}`);
    try {
      const sources = await listSubscriptions();
      for (const source of sources) {
        enqueue('rss_fetch', { url: source.url, name: source.name, isSubscriptionCheck: true });
      }
      console.log(`[RSS Cron] Queued ${sources.length} feed checks`);
    } catch (err) {
      console.error('[RSS Cron] Error:', err);
    } finally {
      isRunning = false;
    }
  });

  console.log(`[RSS Cron] Started, checking every ${intervalMinutes} minutes (${cronExpr})`);
}

export function stopRSSCron() {
  if (task) {
    task.stop();
    task.destroy();
    task = null;
    console.log('[RSS Cron] Stopped');
  }
}

export function restartRSSCron(intervalMinutes: number) {
  stopRSSCron();
  startRSSCron(intervalMinutes);
}
