import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'My Knowledge Base',
  description: 'Personal knowledge base powered by AI',
};

// Start RSS auto-check cron on server boot (only in Node.js runtime, not edge)
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
  import('@/lib/queue').then(({ initQueue }) => initQueue()).catch(() => {});

  (async () => {
    try {
      const { loadSettings } = await import('@/lib/settings');
      const settings = await loadSettings();

      const { startRSSCron } = await import('@/lib/rss/cron');
      startRSSCron(settings.cron.rssIntervalMinutes);

      const { startRelinkCron } = await import('@/lib/relink/cron');
      startRelinkCron(settings.cron.relinkCronExpression);
    } catch {
      // Cron not available in some runtimes (e.g. edge), that's fine
    }
  })();
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className="antialiased">{children}</body>
    </html>
  );
}
