import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWebContent, closeBrowser, resetBrowserForTesting } from '../web';
import { runCamoufox } from '../camoufox-runner';

vi.mock('../camoufox-runner', () => ({
  runCamoufox: vi.fn(),
}));

const mockedRunCamoufox = vi.mocked(runCamoufox);

describe('fetchWebContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBrowserForTesting();
  });

  function mockSuccessResponse(title: string, html: string, bodyText?: string) {
    mockedRunCamoufox.mockImplementation((cmd, args, opts, callback) => {
      if (typeof opts === 'function') {
        callback = opts;
      }
      callback(null, JSON.stringify({ title, html, bodyText }), '');
    });
  }

  it('extracts article via Camoufox + Readability', async () => {
    mockSuccessResponse(
      'Article Title',
      `<html><head><title>Article Title</title></head>
        <body>
          <article>
            <h1>Article Title</h1>
            <p>This is the main content extracted by Readability.</p>
          </article>
        </body></html>`
    );

    const result = await fetchWebContent('https://example.com/article');
    expect(result.title).toBe('Article Title');
    expect(result.content).toContain('main content extracted');
    expect(mockedRunCamoufox).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining([expect.stringContaining('fetch_web.py'), 'https://example.com/article']),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('falls back to body text when Readability fails', async () => {
    mockSuccessResponse(
      'Bad Page',
      `<html><head><title>Bad Page</title></head>
        <body><form><input value="Some text here"></form></body></html>`,
      'Some text here'
    );

    const result = await fetchWebContent('https://example.com/bad');
    expect(result.title).toBe('Bad Page');
    expect(result.content).toContain('Some text here');
  });

  it('propagates error when Python script fails', async () => {
    mockedRunCamoufox.mockImplementation((cmd, args, opts, callback) => {
      if (typeof opts === 'function') {
        callback = opts;
      }
      callback(new Error('camoufox navigation failed'), '', '');
    });

    await expect(fetchWebContent('https://example.com/boom')).rejects.toThrow('camoufox navigation failed');
  });

  it('supports concurrent calls', async () => {
    mockSuccessResponse('Concurrent', '<html><body>race</body></html>');

    const [a, b] = await Promise.all([
      fetchWebContent('https://example.com/a'),
      fetchWebContent('https://example.com/b'),
    ]);

    expect(mockedRunCamoufox).toHaveBeenCalledTimes(2);
    expect(a.title).toBe('Concurrent');
    expect(b.title).toBe('Concurrent');
  });

  it('uses page title when Readability title is empty', async () => {
    mockSuccessResponse(
      'Page Title',
      `<html><head><title>Page Title</title></head>
        <body><article><p>Content without h1.</p></article></body></html>`
    );

    const result = await fetchWebContent('https://example.com/no-h1');
    // Readability may return empty title for article without h1; fallback to page title
    expect(result.title).toBe('Page Title');
    expect(result.content).toContain('Content without h1');
  });

  it('returns empty content when both Readability and bodyText are empty', async () => {
    mockSuccessResponse('', '<html><head></head><body></body></html>', '');

    const result = await fetchWebContent('https://example.com/empty');
    expect(result.title).toBe('https://example.com/empty');
    expect(result.content).toBe('');
    expect(result.excerpt).toBe('');
  });

  it('does not throw on closeBrowser()', async () => {
    await expect(closeBrowser()).resolves.toBeUndefined();
  });
});
