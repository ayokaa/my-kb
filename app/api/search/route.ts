import { FileSystemStorage } from '@/lib/storage';
import { fetchWebContent } from '@/lib/ingestion/web';
import { logger } from '@/lib/logger';

export async function POST(req: Request) {
  const { query, maxResults = 3 } = await req.json();

  try {
    // Use a search API if configured, otherwise return error
    const searchApiKey = process.env.SEARCH_API_KEY;
    const searchEngine = process.env.SEARCH_ENGINE || 'serper';

    if (!searchApiKey) {
      return Response.json(
        { error: 'Search API not configured. Set SEARCH_API_KEY env var.' },
        { status: 503 }
      );
    }

    let results: Array<{ title: string; link: string; snippet: string }> = [];

    if (searchEngine === 'serper') {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': searchApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, num: maxResults }),
      });
      const data = await res.json();
      results = (data.organic || []).map((r: any) => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet,
      }));
    }

    // Fetch content from each result and write to inbox
    const storage = new FileSystemStorage();
    const entries = [];

    for (const result of results) {
      try {
        const web = await fetchWebContent(result.link);
        await storage.writeInbox({
          sourceType: 'web',
          title: web.title,
          content: web.content,
          rawMetadata: {
            search_query: query,
            source_url: result.link,
            search_snippet: result.snippet,
          },
        });
        entries.push({ title: web.title, url: result.link });
      } catch (fetchErr: any) {
        logger.warn('Search', `Failed to fetch search result ${result.link}`, { error: fetchErr });
      }
    }

    return Response.json({ ok: true, entries });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
