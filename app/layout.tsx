import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'My Knowledge Base',
  description: 'Personal knowledge base powered by AI',
};

// Start RSS auto-check cron on server boot (only in Node.js runtime, not edge)
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
  import('@/lib/queue').then(({ initQueue }) => initQueue()).catch(() => {});
  import('@/lib/rss/cron').then(({ startRSSCron }) => {
    startRSSCron(60);
  }).catch(() => {
    // Cron not available in some runtimes (e.g. edge), that's fine
  });
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className="antialiased">{children}</body>
    </html>
  );
}
