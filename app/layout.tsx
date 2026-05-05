import type { Metadata } from 'next';
import './globals.css';
import ThemeProvider from '@/components/ThemeProvider';

export const metadata: Metadata = {
  title: 'My Knowledge Base',
  description: 'Personal knowledge base powered by AI',
};

// Start RSS auto-check cron on server boot (only in Node.js runtime, not edge)
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
  import('@/lib/queue').then(({ initQueue }) => initQueue()).catch(() => {});

  // patchConsole is disabled: all server-side code now uses logger.xxx()
  // explicitly. Keeping it would flood logs with Next.js framework noise.
  // (async () => {
  //   try {
  //     const { patchConsole } = await import('@/lib/logger');
  //     patchConsole();
  //   } catch {}
  // })();

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
    <html lang="zh" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var t = localStorage.getItem('theme');
                  if (t === 'dark' || t === 'light') {
                    document.documentElement.setAttribute('data-theme', t);
                    return;
                  }
                } catch(e) {}
                var m = window.matchMedia('(prefers-color-scheme: light)');
                document.documentElement.setAttribute('data-theme', m.matches ? 'light' : 'dark');
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
