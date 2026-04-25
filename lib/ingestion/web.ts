import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export async function fetchWebContent(url: string): Promise<{ title: string; content: string; excerpt?: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AgentKB/1.0)',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }

  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    // Fallback: return plain text from body
    const bodyText = dom.window.document.body?.textContent?.trim() || '';
    return {
      title: dom.window.document.title || url,
      content: bodyText.slice(0, 10000),
      excerpt: bodyText.slice(0, 200),
    };
  }

  return {
    title: article.title || url,
    content: article.textContent || '',
    excerpt: article.excerpt || '',
  };
}
