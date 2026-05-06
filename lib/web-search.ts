/**
 * Web search abstraction layer.
 *
 * Provides a provider-agnostic interface so the search backend can be
 * swapped without changing call sites (e.g. chat tool use).
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchProvider {
  search(query: string, maxResults?: number): Promise<WebSearchResult[]>;
}

// ── TinyFish provider ────────────────────────────────────────

class TinyFishProvider implements WebSearchProvider {
  async search(query: string, maxResults = 20): Promise<WebSearchResult[]> {
    const { TinyFish } = await import('@tiny-fish/sdk');
    const client = new TinyFish();
    const resp = await client.search.query({ query });
    return (resp.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
    }));
  }
}

// ── Serper (Google) provider ─────────────────────────────────

class SerperProvider implements WebSearchProvider {
  constructor(private apiKey: string) {}

  async search(query: string, maxResults = 20): Promise<WebSearchResult[]> {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: maxResults }),
    });
    if (!res.ok) {
      throw new Error(`Serper API error: ${res.status}`);
    }
    const data = await res.json();
    return (data.organic ?? []).map(
      (r: { title?: string; link?: string; snippet?: string }) => ({
        title: r.title ?? '',
        url: r.link ?? '',
        snippet: r.snippet ?? '',
      })
    );
  }
}

// ── Provider selection ───────────────────────────────────────

/**
 * Return the currently configured web search provider, or `null`
 * if no search API key is available.
 */
export function getWebSearchProvider(): WebSearchProvider | null {
  if (process.env.TINYFISH_API_KEY) {
    return new TinyFishProvider();
  }
  if (process.env.SEARCH_API_KEY) {
    return new SerperProvider(process.env.SEARCH_API_KEY);
  }
  return null;
}

/**
 * Unified search entry point.
 *
 * @throws if no provider is configured.
 */
export async function webSearch(query: string, maxResults = 20): Promise<WebSearchResult[]> {
  const provider = getWebSearchProvider();
  if (!provider) {
    throw new Error('No web search provider configured (set TINYFISH_API_KEY or SEARCH_API_KEY)');
  }
  return provider.search(query, maxResults);
}
