import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chromium } from 'playwright';
import { fetchWebContent, closeBrowser, resetBrowserForTesting } from '../web';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(),
  },
}));

describe('fetchWebContent', () => {
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const mockPageClose = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPageClose.mockClear();
    resetBrowserForTesting();
  });

  function mockPage(html: string, bodyText = '') {
    return {
      goto: vi.fn().mockResolvedValue(undefined),
      title: vi.fn().mockResolvedValue('Test Article'),
      content: vi.fn().mockResolvedValue(html),
      evaluate: vi.fn().mockResolvedValue(bodyText),
      close: mockPageClose,
    };
  }

  function mockBrowser(page: any) {
    return {
      newPage: vi.fn().mockResolvedValue(page),
      close: mockClose,
      isConnected: vi.fn().mockReturnValue(true),
    };
  }

  it('extracts article via Playwright + Readability', async () => {
    vi.mocked(chromium.launch).mockResolvedValue(
      mockBrowser(mockPage(`
        <html><head><title>Test Article</title></head>
        <body>
          <article>
            <h1>Article Title</h1>
            <p>This is the main content extracted by Readability.</p>
          </article>
        </body></html>
      `))
    );

    const result = await fetchWebContent('https://example.com/article');
    expect(result.title).toBeTruthy();
    expect(result.content).toContain('main content extracted');
    expect(mockPageClose).toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('falls back to body text when Readability fails', async () => {
    vi.mocked(chromium.launch).mockResolvedValue(
      mockBrowser(mockPage(`
        <html><head><title>Bad Page</title></head>
        <body><div>Some text here</div></body></html>
      `, 'Some text here'))
    );

    const result = await fetchWebContent('https://example.com/bad');
    expect(result.title).toBe('Bad Page');
    expect(result.content).toContain('Some text here');
    expect(mockPageClose).toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('closes page even on error', async () => {
    const errorPage = {
      goto: vi.fn().mockRejectedValue(new Error('navigation failed')),
      close: mockPageClose,
    };
    vi.mocked(chromium.launch).mockResolvedValue(mockBrowser(errorPage));

    await expect(fetchWebContent('https://example.com/boom')).rejects.toThrow('navigation failed');
    expect(mockPageClose).toHaveBeenCalled();
  });

  it('reuses the same browser instance across multiple calls', async () => {
    vi.mocked(chromium.launch).mockResolvedValue(
      mockBrowser(mockPage('<html><body>test</body></html>'))
    );

    await fetchWebContent('https://example.com/a');
    await fetchWebContent('https://example.com/b');

    // Browser should only be launched once
    expect(chromium.launch).toHaveBeenCalledTimes(1);
    // Pages should be closed after each use, but browser stays open
    expect(mockPageClose).toHaveBeenCalledTimes(2);
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('recovers from a crashed browser by re-launching', async () => {
    const deadBrowser = {
      newPage: vi.fn().mockRejectedValue(new Error('browser crashed')),
      close: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(false),
    };
    const healthyBrowser = {
      ...mockBrowser(mockPage('<html><body>recovered</body></html>')),
      isConnected: vi.fn().mockReturnValue(true),
    };

    let callCount = 0;
    vi.mocked(chromium.launch).mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? (deadBrowser as any) : (healthyBrowser as any));
    });

    await fetchWebContent('https://example.com/crash');

    // Should have launched twice: first fails health check, then retry succeeds
    expect(chromium.launch).toHaveBeenCalledTimes(2);
    expect(mockPageClose).toHaveBeenCalled();
  });

  it('closes browser on closeBrowser()', async () => {
    vi.mocked(chromium.launch).mockResolvedValue(
      mockBrowser(mockPage('<html><body>test</body></html>'))
    );

    await fetchWebContent('https://example.com/close');
    await closeBrowser();

    expect(mockClose).toHaveBeenCalled();
  });
});
