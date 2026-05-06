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

  function mockResponse(title: string, content: string) {
    mockedRunCamoufox.mockImplementation((cmd, args, opts, callback) => {
      if (typeof opts === 'function') {
        callback = opts;
      }
      callback(null, JSON.stringify({ title, content }), '');
    });
  }

  it('returns extracted title and content from Python script', async () => {
    mockResponse('Test Article', 'This is the main content extracted by trafilatura.');

    const result = await fetchWebContent('https://example.com/article');
    expect(result.title).toBe('Test Article');
    expect(result.content).toContain('main content extracted');
    expect(result.excerpt).toContain('main content extracted');
    expect(mockedRunCamoufox).toHaveBeenCalledWith(
      expect.stringContaining('python3'),
      expect.arrayContaining([expect.stringContaining('fetch_web.py'), 'https://example.com/article']),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('uses URL as title when title is empty', async () => {
    mockResponse('', 'Some text here');

    const result = await fetchWebContent('https://example.com/bad');
    expect(result.title).toBe('https://example.com/bad');
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
    mockResponse('Concurrent', 'race content');

    const [a, b] = await Promise.all([
      fetchWebContent('https://example.com/a'),
      fetchWebContent('https://example.com/b'),
    ]);

    expect(mockedRunCamoufox).toHaveBeenCalledTimes(2);
    expect(a.title).toBe('Concurrent');
    expect(b.title).toBe('Concurrent');
  });

  it('truncates content to 10000 chars', async () => {
    mockResponse('Long', 'x'.repeat(20000));

    const result = await fetchWebContent('https://example.com/long');
    expect(result.content.length).toBe(10000);
    expect(result.excerpt!.length).toBe(200);
  });

  it('rejects invalid URL schemes', async () => {
    await expect(fetchWebContent('ftp://example.com/file')).rejects.toThrow('Invalid URL');
    await expect(fetchWebContent('file:///etc/passwd')).rejects.toThrow('Invalid URL');
    await expect(fetchWebContent('not-a-url')).rejects.toThrow('Invalid URL');
  });

  it('rejects private IP URLs', async () => {
    await expect(fetchWebContent('http://127.0.0.1')).rejects.toThrow('Invalid URL');
    await expect(fetchWebContent('http://192.168.1.1')).rejects.toThrow('Invalid URL');
  });

  it('throws friendly error when Python stdout is not valid JSON', async () => {
    mockedRunCamoufox.mockImplementation((cmd, args, opts, callback) => {
      if (typeof opts === 'function') {
        callback = opts;
      }
      callback(null, 'some warning from camoufox\n', '');
    });

    await expect(fetchWebContent('https://example.com/bad-json')).rejects.toThrow('Failed to parse web fetch result');
  });

  it('does not throw on closeBrowser()', async () => {
    await expect(closeBrowser()).resolves.toBeUndefined();
  });

  it('throws when content is empty (page timeout)', async () => {
    mockResponse('Some Title', '');

    await expect(fetchWebContent('https://example.com/slow')).rejects.toThrow(
      'returned empty content'
    );
  });

  it('throws when content is whitespace only', async () => {
    mockResponse('Some Title', '   \n  ');

    await expect(fetchWebContent('https://example.com/blank')).rejects.toThrow(
      'returned empty content'
    );
  });
});

describe('fetchWebContent — TinyFish primary path', () => {
  const mockGetContents = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetBrowserForTesting();
    process.env.TINYFISH_API_KEY = 'test-tf-key';

    vi.doMock('@tiny-fish/sdk', () => ({
      TinyFish: vi.fn().mockImplementation(function () {
        return { fetch: { getContents: mockGetContents } };
      }),
    }));
  });

  afterEach(() => {
    delete process.env.TINYFISH_API_KEY;
    vi.resetModules();
  });

  it('uses TinyFish when TINYFISH_API_KEY is set', async () => {
    mockGetContents.mockResolvedValue({
      results: [{ url: 'https://example.com/a', title: 'TF Article', text: 'Content from TinyFish', format: 'markdown' }],
      errors: [],
    });

    const { fetchWebContent } = await import('../web');
    const result = await fetchWebContent('https://example.com/a');

    expect(result.title).toBe('TF Article');
    expect(result.content).toBe('Content from TinyFish');
    expect(mockGetContents).toHaveBeenCalledWith({ urls: ['https://example.com/a'], format: 'markdown' });
  });

  it('falls back to Camoufox when TinyFish fails', async () => {
    mockGetContents.mockRejectedValue(new Error('TinyFish timeout'));

    // Also need to mock camoufox-runner for fallback
    vi.doMock('../camoufox-runner', () => ({
      runCamoufox: vi.fn().mockImplementation((_cmd: string, _args: string[], _opts: any, callback: any) => {
        callback(null, JSON.stringify({ title: 'Fallback', content: 'from camoufox' }), '');
      }),
    }));

    const { fetchWebContent } = await import('../web');
    const result = await fetchWebContent('https://example.com/fallback');

    expect(result.title).toBe('Fallback');
    expect(result.content).toBe('from camoufox');
    expect(mockGetContents).toHaveBeenCalled();
  });

  it('falls back to Camoufox when TinyFish returns empty content', async () => {
    mockGetContents.mockResolvedValue({
      results: [{ url: 'https://example.com/empty', title: null, text: null, format: 'markdown' }],
      errors: [],
    });

    vi.doMock('../camoufox-runner', () => ({
      runCamoufox: vi.fn().mockImplementation((_cmd: string, _args: string[], _opts: any, callback: any) => {
        callback(null, JSON.stringify({ title: 'Camoufox', content: 'camoufox content' }), '');
      }),
    }));

    const { fetchWebContent } = await import('../web');
    const result = await fetchWebContent('https://example.com/empty');

    expect(result.title).toBe('Camoufox');
  });

  it('handles TinyFish fetch errors in response', async () => {
    mockGetContents.mockResolvedValue({
      results: [],
      errors: [{ url: 'https://example.com/err', error: 'page not found' }],
    });

    vi.doMock('../camoufox-runner', () => ({
      runCamoufox: vi.fn().mockImplementation((_cmd: string, _args: string[], _opts: any, callback: any) => {
        callback(null, JSON.stringify({ title: 'Fallback', content: 'ok' }), '');
      }),
    }));

    const { fetchWebContent } = await import('../web');
    const result = await fetchWebContent('https://example.com/err');

    // Should fall back to Camoufox
    expect(result.title).toBe('Fallback');
  });

  it('truncates TinyFish content to 10000 chars', async () => {
    mockGetContents.mockResolvedValue({
      results: [{ url: 'https://example.com/long', title: 'Long', text: 'y'.repeat(20000), format: 'markdown' }],
      errors: [],
    });

    const { fetchWebContent } = await import('../web');
    const result = await fetchWebContent('https://example.com/long');

    expect(result.content.length).toBe(10000);
    expect(result.excerpt!.length).toBe(200);
  });

  it('uses URL as title when TinyFish returns null title', async () => {
    mockGetContents.mockResolvedValue({
      results: [{ url: 'https://example.com/notitle', title: null, text: 'some text', format: 'markdown' }],
      errors: [],
    });

    const { fetchWebContent } = await import('../web');
    const result = await fetchWebContent('https://example.com/notitle');

    expect(result.title).toBe('https://example.com/notitle');
  });
});
