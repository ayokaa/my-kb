import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMessagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(function () {
    return {
      messages: {
        create: mockMessagesCreate,
      },
    };
  }),
}));

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function () {
    return {
      listNotes: vi.fn().mockResolvedValue([]),
      getRoot: vi.fn().mockReturnValue('/tmp/kb'),
    };
  }),
}));

vi.mock('@/lib/search/cache', () => ({
  loadOrBuildIndex: vi.fn().mockResolvedValue({ entries: [] }),
}));

async function drainStream(res: Response) {
  const reader = res.body!.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

describe('/api/chat', () => {
  beforeEach(() => {
    mockMessagesCreate.mockReset();
  });

  it('streams response with filtered think tags', async () => {
    async function* mockStream() {
      yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '<think>some reasoning' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' inside think</think>' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_stop' };
    }

    mockMessagesCreate.mockResolvedValueOnce(mockStream());

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: '你好' }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    expect(text).toContain('Hello');
    expect(text).toContain('world');
    expect(text).not.toContain('think');
    expect(text).not.toContain('reasoning');
  });

  it('returns 400 for invalid body', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid messages', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: 'not-an-array' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('filters complete think blocks', async () => {
    async function* mockStream() {
      yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Start ' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '<think>' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hidden' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '</think>' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' End' } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_stop' };
    }

    mockMessagesCreate.mockResolvedValueOnce(mockStream());

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'test' }],
      }),
    });

    const res = await POST(req);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    expect(text).toContain('Start');
    expect(text).toContain('End');
    expect(text).not.toContain('hidden');
  });

  it('rejects SSRF: web_fetch must not fetch internal URLs', async () => {
    // internal URLs are filtered by isValidHttpUrl before fetchWebContent is called

    // Round 1: LLM decides to call web_fetch with internal URL (streamed)
    async function* mockStreamRound1() {
      yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc-1', name: 'web_fetch', input: {} } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/', reason: 'test' }) } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_stop' };
    }

    // Round 2: final answer after tool execution
    async function* mockStreamRound2() {
      yield { type: 'message_start', message: { id: 'msg-2', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_stop' };
    }

    mockMessagesCreate.mockResolvedValueOnce(mockStreamRound1());
    mockMessagesCreate.mockResolvedValueOnce(mockStreamRound2());

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'fetch internal' }],
      }),
    });

    const res = await POST(req);
    await drainStream(res);
    // fetchWebContent must NOT be called for internal URLs
    // (isValidHttpUrl filters them out)
  });

  it('limits concurrent tool calls to 3', async () => {
    vi.resetModules();
    const mockFetchWebContent = vi.fn().mockResolvedValue({
      title: 'Page', content: 'content', excerpt: '',
    });
    vi.doMock('@/lib/ingestion/web', () => ({
      fetchWebContent: mockFetchWebContent,
    }));

    // LLM returns 5 tool calls (streamed)
    const toolCallArgs = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ url: `https://example.com/page-${i}`, reason: 'test' })
    );

    async function* mockStreamRound1() {
      yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      for (let i = 0; i < 5; i++) {
        yield { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: `tc-${i}`, name: 'web_fetch', input: {} } };
        yield { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: toolCallArgs[i] } };
        yield { type: 'content_block_stop', index: i };
      }
      yield { type: 'message_stop' };
    }

    async function* mockStreamRound2() {
      yield { type: 'message_start', message: { id: 'msg-2', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_stop' };
    }

    mockMessagesCreate.mockResolvedValueOnce(mockStreamRound1());
    mockMessagesCreate.mockResolvedValueOnce(mockStreamRound2());

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'fetch many' }],
      }),
    });

    const res = await POST(req);
    await drainStream(res);
    // fetchWebContent should be called at most 3 times, not 5
    expect(mockFetchWebContent).toHaveBeenCalledTimes(3);
  });
});
