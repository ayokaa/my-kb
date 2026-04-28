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
      'python3',
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
});
