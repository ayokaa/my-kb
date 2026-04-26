import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chromium } from 'playwright';
import { fetchWebContent } from '../web';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(),
  },
}));

describe('fetchWebContent', () => {
  const mockClose = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockPage(html: string, bodyText = '') {
    return {
      goto: vi.fn().mockResolvedValue(undefined),
      title: vi.fn().mockResolvedValue('Test Article'),
      content: vi.fn().mockResolvedValue(html),
      evaluate: vi.fn().mockResolvedValue(bodyText),
    };
  }

  it('extracts article via Playwright + Readability', async () => {
    vi.mocked(chromium.launch).mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(mockPage(`
        <html><head><title>Test Article</title></head>
        <body>
          <article>
            <h1>Article Title</h1>
            <p>This is the main content extracted by Readability.</p>
          </article>
        </body></html>
      `)),
      close: mockClose,
    } as any);

    const result = await fetchWebContent('https://example.com/article');
    expect(result.title).toBeTruthy();
    expect(result.content).toContain('main content extracted');
    expect(mockClose).toHaveBeenCalled();
  });

  it('falls back to body text when Readability fails', async () => {
    vi.mocked(chromium.launch).mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(mockPage(`
        <html><head><title>Bad Page</title></head>
        <body><div>Some text here</div></body></html>
      `, 'Some text here')),
      close: mockClose,
    } as any);

    const result = await fetchWebContent('https://example.com/bad');
    expect(result.title).toBe('Bad Page');
    expect(result.content).toContain('Some text here');
    expect(mockClose).toHaveBeenCalled();
  });

  it('closes browser even on error', async () => {
    vi.mocked(chromium.launch).mockRejectedValue(new Error('launch failed'));

    await expect(fetchWebContent('https://example.com/boom')).rejects.toThrow('launch failed');
  });
});
