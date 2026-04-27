import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/ingestion/web', () => ({
  fetchWebContent: vi.fn().mockResolvedValue({ title: 'Web', content: 'content', excerpt: '' }),
}));

describe('processInboxEntry — LLM JSON fallback', () => {
  it('extracts JSON from markdown code block', async () => {
    vi.doMock('openai', () => ({
      default: function () {
        return {
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                choices: [{
                  message: {
                    content: '```json\n{"title":"Code Block","tags":[],"summary":"","personalContext":"","keyFacts":[],"timeline":[],"links":[],"qas":[],"content":"body"}\n```',
                  },
                }],
              }),
            },
          },
        };
      },
    }));

    const { processInboxEntry } = await import('../ingest');
    const entry = {
      sourceType: 'text' as const,
      title: 'Code Block Test',
      content: 'some content',
      rawMetadata: {},
    };

    const { note } = await processInboxEntry(entry);
    expect(note.title).toBe('Code Block');

    vi.doUnmock('openai');
  });

  it('extracts JSON from surrounding text via regex fallback', async () => {
    vi.resetModules();
    vi.doMock('openai', () => ({
      default: function () {
        return {
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                choices: [{
                  message: {
                    content: 'Here is the result:\n\n{"title":"Extracted","tags":[],"summary":"","personalContext":"","keyFacts":[],"timeline":[],"links":[],"qas":[],"content":"c"}\n\nHope that helps!',
                  },
                }],
              }),
            },
          },
        };
      },
    }));

    const { processInboxEntry } = await import('../ingest');
    const entry = {
      sourceType: 'text' as const,
      title: 'Extract Test',
      content: 'content',
      rawMetadata: {},
    };

    const { note } = await processInboxEntry(entry);
    expect(note.title).toBe('Extracted');

    vi.doUnmock('openai');
  });
});
