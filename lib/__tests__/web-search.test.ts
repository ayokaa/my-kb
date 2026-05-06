import { describe, it, expect, vi, beforeEach } from 'vitest';

// We mock @tiny-fish/sdk before importing our module
const mockSearchQuery = vi.fn();

vi.mock('@tiny-fish/sdk', () => ({
  TinyFish: vi.fn().mockImplementation(function () {
    return { search: { query: mockSearchQuery } };
  }),
}));

// Mock global fetch for Serper provider tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  getWebSearchProvider,
  webSearch,
  WebSearchResult,
} from '../web-search';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TINYFISH_API_KEY;
  delete process.env.SEARCH_API_KEY;
});

describe('getWebSearchProvider', () => {
  it('returns null when no API key is set', () => {
    expect(getWebSearchProvider()).toBeNull();
  });

  it('returns TinyFish provider when TINYFISH_API_KEY is set', () => {
    process.env.TINYFISH_API_KEY = 'test-tf-key';
    const provider = getWebSearchProvider();
    expect(provider).not.toBeNull();
    // It should be a TinyFishProvider (no easy way to check class, so verify behavior)
  });

  it('returns Serper provider when only SEARCH_API_KEY is set', () => {
    process.env.SEARCH_API_KEY = 'test-serper-key';
    const provider = getWebSearchProvider();
    expect(provider).not.toBeNull();
  });

  it('prefers TinyFish over Serper when both keys are set', async () => {
    process.env.TINYFISH_API_KEY = 'test-tf-key';
    process.env.SEARCH_API_KEY = 'test-serper-key';

    mockSearchQuery.mockResolvedValue({ results: [] });

    const provider = getWebSearchProvider();
    await provider!.search('test');

    expect(mockSearchQuery).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('webSearch', () => {
  it('throws when no provider is configured', async () => {
    await expect(webSearch('test')).rejects.toThrow('No web search provider configured');
  });

  it('calls TinyFish SDK and normalizes results', async () => {
    process.env.TINYFISH_API_KEY = 'test-tf-key';

    mockSearchQuery.mockResolvedValue({
      results: [
        { position: 1, site_name: 'Example', title: 'Test Result', url: 'https://example.com', snippet: 'A test snippet' },
        { position: 2, site_name: 'Another', title: 'Second Result', url: 'https://another.com', snippet: 'Another snippet' },
      ],
    });

    const results = await webSearch('test query', 5);

    expect(mockSearchQuery).toHaveBeenCalledWith({ query: 'test query' });
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Test Result',
      url: 'https://example.com',
      snippet: 'A test snippet',
    });
  });

  it('respects maxResults limit', async () => {
    process.env.TINYFISH_API_KEY = 'test-tf-key';

    const manyResults = Array.from({ length: 30 }, (_, i) => ({
      position: i + 1,
      site_name: 'Site',
      title: `Result ${i}`,
      url: `https://example.com/${i}`,
      snippet: `Snippet ${i}`,
    }));
    mockSearchQuery.mockResolvedValue({ results: manyResults });

    const results = await webSearch('test', 10);
    expect(results).toHaveLength(10);
  });

  it('defaults to 20 results when maxResults not specified', async () => {
    process.env.TINYFISH_API_KEY = 'test-tf-key';

    const manyResults = Array.from({ length: 30 }, (_, i) => ({
      position: i + 1,
      site_name: 'Site',
      title: `Result ${i}`,
      url: `https://example.com/${i}`,
      snippet: `Snippet ${i}`,
    }));
    mockSearchQuery.mockResolvedValue({ results: manyResults });

    const results = await webSearch('test');
    expect(results).toHaveLength(20);
  });

  it('handles empty results gracefully', async () => {
    process.env.TINYFISH_API_KEY = 'test-tf-key';
    mockSearchQuery.mockResolvedValue({ results: [] });

    const results = await webSearch('obscure query');
    expect(results).toEqual([]);
  });

  it('uses Serper as fallback when TinyFish key is not set', async () => {
    process.env.SEARCH_API_KEY = 'serper-key';

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          organic: [
            { title: 'Serper Result', link: 'https://serper.com', snippet: 'From Serper' },
          ],
        }),
    });

    const results = await webSearch('test');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://google.serper.dev/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-API-KEY': 'serper-key' }),
      })
    );
    expect(results).toEqual([
      { title: 'Serper Result', url: 'https://serper.com', snippet: 'From Serper' },
    ]);
  });

  it('throws on Serper API error', async () => {
    process.env.SEARCH_API_KEY = 'serper-key';

    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
    });

    await expect(webSearch('test')).rejects.toThrow('Serper API error: 429');
  });
});
