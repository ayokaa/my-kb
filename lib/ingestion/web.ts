import { chromium } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const FETCH_TIMEOUT = 20000;

export async function fetchWebContent(url: string): Promise<{ title: string; content: string; excerpt?: string }> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
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
    await browser.close();
  }
}
