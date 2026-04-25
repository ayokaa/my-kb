import cron from 'node-cron';
import { checkAllFeeds } from './manager';

let started = false;

export function startRSSCron(intervalMinutes = 60) {
  if (started) return;
  started = true;

  // Run every N minutes
  const cronExpr = `*/${Math.max(1, Math.min(intervalMinutes, 59))} * * * *`;

  cron.schedule(cronExpr, async () => {
    console.log(`[RSS Cron] Checking all feeds at ${new Date().toISOString()}`);
    try {
      const results = await checkAllFeeds();
      const totalNew = results.reduce((sum, r) => sum + r.newItems, 0);
      console.log(`[RSS Cron] Done: ${totalNew} new items from ${results.length} feeds`);
    } catch (err) {
      console.error('[RSS Cron] Error:', err);
    }
  });

  console.log(`[RSS Cron] Started, checking every ${intervalMinutes} minutes`);
}
