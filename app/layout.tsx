import type { Metadata } from 'next';
import { Cormorant_Garamond, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const serif = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-serif',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'My Knowledge Base',
  description: 'Personal knowledge base powered by AI',
};

// Start RSS auto-check cron on server boot (only in Node.js runtime, not edge)
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
  import('@/lib/rss/cron').then(({ startRSSCron }) => {
    startRSSCron(60);
  }).catch(() => {
    // Cron not available in some runtimes (e.g. edge), that's fine
  });
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" className={`${serif.variable} ${mono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
