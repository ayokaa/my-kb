import cron from 'node-cron';
import { enqueue } from '@/lib/queue';

let started = false;
let isRunning = false;

export function startRelinkCron() {
  if (started) return;
  started = true;

  cron.schedule('0 3 * * *', async () => {
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

  console.log('[Relink Cron] Started, scheduled daily at 03:00 (0 3 * * *)');
}
