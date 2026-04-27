import cron from 'node-cron';
import { listSubscriptions } from './manager';
import { enqueue } from '@/lib/queue';

let started = false;
let isRunning = false;

export function startRSSCron(intervalMinutes = 60) {
  if (started) return;
  started = true;

  // Build cron expression: hourly (0 * * * *) or every N minutes (*/N * * * *)
  const n = Math.max(1, intervalMinutes);
  const cronExpr = n >= 60 ? '0 * * * *' : `*/${n} * * * *`;

  cron.schedule(cronExpr, async () => {
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
