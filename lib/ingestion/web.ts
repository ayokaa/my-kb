import { chromium, type Browser } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const FETCH_TIMEOUT = 20000;

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      if (!browser.isConnected()) {
        throw new Error('Browser disconnected');
      }
      return browser;
    } catch {
      browserPromise = null;
    }
  }
  browserPromise = chromium.launch({ headless: true });
  browserPromise.catch(() => {
    // Reset on failure so next call can retry
    browserPromise = null;
  });
  const browser = await browserPromise;
  if (!browser.isConnected()) {
    // Launch succeeded but instance is unhealthy — retry once
    browserPromise = null;
    browserPromise = chromium.launch({ headless: true });
    browserPromise.catch(() => {
      browserPromise = null;
    });
    return await browserPromise;
  }
  return browser;
}

// Graceful shutdown on process termination
process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      await browser.close();
    } catch {
      // Ignore errors during cleanup
    }
    browserPromise = null;
  }
}

/** Reset the browser singleton (test-only). */
export function resetBrowserForTesting() {
  browserPromise = null;
}

export async function fetchWebContent(url: string): Promise<{ title: string; content: string; excerpt?: string }> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: FETCH_TIMEOUT });

    const title = await page.title();
    const html = await page.content();

    // Parse with Readability on the fully-rendered DOM
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();

    if (article) {
      return {
        title: article.title || title || url,
        content: article.textContent || '',
        excerpt: article.excerpt || '',
      };
    }

    // Fallback: plain body text
    const bodyText = await page.evaluate(() => document.body?.innerText?.trim() || '');
    return {
      title: title || url,
      content: bodyText.slice(0, 10000),
      excerpt: bodyText.slice(0, 200),
    };
  } finally {
    await page.close();
  }
}
