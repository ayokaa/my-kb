import cron from 'node-cron';
import { listSubscriptions } from './manager';
import { enqueue } from '@/lib/queue';

let started = false;

export function startRSSCron(intervalMinutes = 60) {
  if (started) return;
  started = true;

  // Run every N minutes
  const cronExpr = `*/${Math.max(1, Math.min(intervalMinutes, 59))} * * * *`;

  cron.schedule(cronExpr, async () => {
    console.log(`[RSS Cron] Queuing feed checks at ${new Date().toISOString()}`);
    try {
      const sources = await listSubscriptions();
      for (const source of sources) {
        enqueue('rss_fetch', { url: source.url, name: source.name, isSubscriptionCheck: true });
      }
      console.log(`[RSS Cron] Queued ${sources.length} feed checks`);
    } catch (err) {
      console.error('[RSS Cron] Error:', err);
    }
  });

  console.log(`[RSS Cron] Started, checking every ${intervalMinutes} minutes`);
}
