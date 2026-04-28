import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/ingestion/web', () => ({
  fetchWebContent: vi.fn().mockResolvedValue({ title: 'Web', content: 'content', excerpt: '' }),
}));

function anthropicResponse(text: string) {
  return {
    id: 'msg-test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: '',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

describe('processInboxEntry — LLM JSON fallback', () => {
  it('extracts JSON from markdown code block in step 1', async () => {
    let callIndex = 0;
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: function () {
        return {
          messages: {
            create: vi.fn().mockImplementation(() => {
              callIndex++;
              if (callIndex === 1) {
                return Promise.resolve(anthropicResponse(
                  '```json\n{"title":"Code Block","tags":[],"summary":"","personalContext":"","keyFacts":[],"timeline":[],"content":"body"}\n```'
                ));
              }
              if (callIndex === 2) {
                return Promise.resolve(anthropicResponse('{"qas":[]}'));
              }
              return Promise.resolve(anthropicResponse('{"links":[]}'));
            }),
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

    vi.doUnmock('@anthropic-ai/sdk');
  });

  it('extracts JSON from surrounding text via regex fallback in step 1', async () => {
    vi.resetModules();
    let callIndex = 0;
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: function () {
        return {
          messages: {
            create: vi.fn().mockImplementation(() => {
              callIndex++;
              if (callIndex === 1) {
                return Promise.resolve(anthropicResponse(
                  'Here is the result:\n\n{"title":"Extracted","tags":[],"summary":"","personalContext":"","keyFacts":[],"timeline":[],"content":"c"}\n\nHope that helps!'
                ));
              }
              if (callIndex === 2) {
                return Promise.resolve(anthropicResponse('{"qas":[]}'));
              }
              return Promise.resolve(anthropicResponse('{"links":[]}'));
            }),
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

    vi.doUnmock('@anthropic-ai/sdk');
  });
});
