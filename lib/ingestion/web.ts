import { chromium, type Browser } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const FETCH_TIMEOUT = 20000;

let browserPromise: Promise<Browser> | null = null;
let launchPromise: Promise<Browser> | null = null;

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

  if (!launchPromise) {
    launchPromise = (async () => {
      let p = chromium.launch({ headless: true });
      p.catch(() => {
        browserPromise = null;
      });
      let browser = await p;
      if (!browser.isConnected()) {
        browserPromise = null;
        p = chromium.launch({ headless: true });
        p.catch(() => {
          browserPromise = null;
        });
        browser = await p;
      }
      browserPromise = p;
      return browser;
    })();
  }

  try {
    return await launchPromise;
  } finally {
    launchPromise = null;
  }
}

// Graceful shutdown on process termination
process.on('SIGTERM', () => {
  closeBrowser().finally(() => process.exit(0));
});
process.on('SIGINT', () => {
  closeBrowser().finally(() => process.exit(0));
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
    // networkidle often fails on sites with persistent analytics/tracking.
    // Try domcontentloaded first (fast), fallback to networkidle on timeout.
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: FETCH_TIMEOUT });
    } catch {
      await page.goto(url, { waitUntil: 'load', timeout: FETCH_TIMEOUT });
    }

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
