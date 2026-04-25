import { describe, it, expect, vi } from 'vitest';
import { fetchWebContent } from '../web';

describe('fetchWebContent', () => {
  it('extracts article with Readability', async () => {
    const html = `
      <html><head><title>Test Page</title></head>
      <body>
        <article>
          <h1>Article Title</h1>
          <p>This is the main content.</p>
        </article>
      </body></html>
    `;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    }));

    const result = await fetchWebContent('https://example.com/article');
    expect(result.title).toBe('Test Page');
    expect(result.content).toContain('This is the main content');

    vi.unstubAllGlobals();
  });

  it('falls back to body text when Readability fails', async () => {
    const html = `<html><head><title>Bad Page</title></head><body><div>Some text here</div></body></html>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    }));

    const result = await fetchWebContent('https://example.com/bad');
    expect(result.title).toBe('Bad Page');
    expect(result.content).toContain('Some text here');

    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    await expect(fetchWebContent('https://example.com/404')).rejects.toThrow('404');

    vi.unstubAllGlobals();
  });
});
