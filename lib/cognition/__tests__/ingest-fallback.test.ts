import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/ingestion/web', () => ({
  fetchWebContent: vi.fn().mockResolvedValue({ title: 'Web', content: 'content', excerpt: '' }),
}));

describe('processInboxEntry — LLM JSON fallback', () => {
  it('extracts JSON from markdown code block in step 1', async () => {
    let callIndex = 0;
    vi.doMock('openai', () => ({
      default: function () {
        return {
          chat: {
            completions: {
              create: vi.fn().mockImplementation(() => {
                callIndex++;
                if (callIndex === 1) {
                  return Promise.resolve({
                    choices: [{
                      message: {
                        content: '```json\n{"title":"Code Block","tags":[],"summary":"","personalContext":"","keyFacts":[],"timeline":[],"content":"body"}\n```',
                      },
                    }],
                  });
                }
                if (callIndex === 2) {
                  return Promise.resolve({
                    choices: [{ message: { content: '{"qas":[]}' } }],
                  });
                }
                return Promise.resolve({
                  choices: [{ message: { content: '{"links":[]}' } }],
                });
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

  it('extracts JSON from surrounding text via regex fallback in step 1', async () => {
    vi.resetModules();
    let callIndex = 0;
    vi.doMock('openai', () => ({
      default: function () {
        return {
          chat: {
            completions: {
              create: vi.fn().mockImplementation(() => {
                callIndex++;
                if (callIndex === 1) {
                  return Promise.resolve({
                    choices: [{
                      message: {
                        content: 'Here is the result:\n\n{"title":"Extracted","tags":[],"summary":"","personalContext":"","keyFacts":[],"timeline":[],"content":"c"}\n\nHope that helps!',
                      },
                    }],
                  });
                }
                if (callIndex === 2) {
                  return Promise.resolve({
                    choices: [{ message: { content: '{"qas":[]}' } }],
                  });
                }
                return Promise.resolve({
                  choices: [{ message: { content: '{"links":[]}' } }],
                });
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
