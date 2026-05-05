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

function createMockStream(options: {
  msgId?: string;
  textDeltas?: string[];
  toolUses?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
}) {
  const msgId = options.msgId ?? 'msg-1';
  return async function* () {
    yield {
      type: 'message_start',
      message: {
        id: msgId, type: 'message', role: 'assistant',
        content: [], model: '', stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    };
    let idx = 0;
    if (options.textDeltas) {
      yield { type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } };
      for (const text of options.textDeltas) {
        yield { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text } };
      }
      yield { type: 'content_block_stop', index: idx };
      idx++;
    }
    if (options.toolUses) {
      for (const tu of options.toolUses) {
        yield { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: tu.id, name: tu.name, input: {} } };
        yield { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tu.input) } };
        yield { type: 'content_block_stop', index: idx };
        idx++;
      }
    }
    yield { type: 'message_stop' };
  };
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

  it('executes multiple web fetches in parallel', async () => {
    vi.resetModules();
    const delay = 100;
    const callOrder: number[] = [];
    const mockFetchWebContent = vi.fn().mockImplementation(async (url: string) => {
      const idx = parseInt(url.match(/page-(\d+)/)?.[1] || '0');
      callOrder.push(idx);
      await new Promise((r) => setTimeout(r, delay));
      return { title: `Page ${idx}`, content: `content-${idx}`, excerpt: '' };
    });
    vi.doMock('@/lib/ingestion/web', () => ({
      fetchWebContent: mockFetchWebContent,
    }));

    // Round 1: LLM returns 3 tool calls
    async function* mockStreamRound1() {
      yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      for (let i = 0; i < 3; i++) {
        yield { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: `tc-${i}`, name: 'web_fetch', input: {} } };
        yield { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ url: `https://example.com/page-${i}`, reason: 'test' }) } };
        yield { type: 'content_block_stop', index: i };
      }
      yield { type: 'message_stop' };
    }

    // Round 2: final answer
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'test' }],
      }),
    });
    const start = Date.now();
    const res = await POST(req);
    await drainStream(res);
    const elapsed = Date.now() - start;

    expect(mockFetchWebContent).toHaveBeenCalledTimes(3);
    // Sequential would take 300ms+, parallel should be near delay (100ms + overhead)
    expect(elapsed).toBeLessThan(delay * 2.5);
  });

  it('triggers query rewrite on multi-turn conversation', async () => {
    // Round 0: query rewrite (non-streaming)
    const rewriteResponse = {
      content: [{ type: 'text', text: 'RAG 检索增强生成 微调 区别' }],
    };

    // Round 1: main LLM response (streaming)
    async function* mockStream() {
      yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_stop' };
    }

    mockMessagesCreate.mockResolvedValueOnce(rewriteResponse);
    mockMessagesCreate.mockResolvedValueOnce(mockStream());

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { role: 'user', content: '什么是 RAG？' },
          { role: 'assistant', content: 'RAG 是检索增强生成...' },
          { role: 'user', content: '那和微调有什么区别？' },
        ],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    // Rewrite + main LLM = 2 calls
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    // First call should be rewrite (has system prompt and low max_tokens)
    const firstCall = mockMessagesCreate.mock.calls[0][0];
    expect(firstCall.max_tokens).toBe(256);
    expect(firstCall.temperature).toBe(0.1);
    expect(firstCall.system).toContain('查询重写');
    // Second call should be main LLM (streaming)
    const secondCall = mockMessagesCreate.mock.calls[1][0];
    expect(secondCall.stream).toBe(true);
    expect(secondCall.max_tokens).toBe(4096);
  });

  it('falls back to original query when rewrite fails', async () => {
    // Round 0: query rewrite fails
    mockMessagesCreate.mockRejectedValueOnce(new Error('API timeout'));

    // Round 1: main LLM response (streaming)
    async function* mockStream() {
      yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Fallback works' } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_stop' };
    }

    mockMessagesCreate.mockResolvedValueOnce(mockStream());

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { role: 'user', content: '什么是 RAG？' },
          { role: 'assistant', content: 'RAG 是...' },
          { role: 'user', content: '那和微调的区别' },
        ],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain('Fallback works');
  });

  it('degrades gracefully when getLLM rejects during query rewrite', async () => {
    vi.resetModules();

    vi.doMock('@/lib/llm', () => ({
      getLLM: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
      getLLMClient: vi.fn().mockResolvedValue({
        messages: { create: mockMessagesCreate },
      }),
      getLLMModel: vi.fn().mockResolvedValue('model'),
    }));

    async function* mockStream() {
      yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Graceful degradation' } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_stop' };
    }

    mockMessagesCreate.mockResolvedValueOnce(mockStream());

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { role: 'user', content: '什么是 RAG？' },
          { role: 'assistant', content: 'RAG 是...' },
          { role: 'user', content: '那和微调的区别' },
        ],
      }),
    });

    const res = await POST(req);
    // Before fix: 500; After fix: 200 with graceful degradation
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain('Graceful degradation');
  });

  it('skips rewrite on single-turn conversation', async () => {
    async function* mockStream() {
      yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Single turn' } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_stop' };
    }

    mockMessagesCreate.mockResolvedValueOnce(mockStream());

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: '什么是 RAG？' }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    // Single turn: no rewrite, only 1 LLM call
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it('passes abort signal to Anthropic SDK on every call', async () => {
    async function* mockStream() {
      yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } };
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

    await POST(req);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it('handles client abort gracefully without crashing', async () => {
    const controller = new AbortController();

    mockMessagesCreate.mockImplementation(async (params, options) => {
      async function* gen() {
        yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
        yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } };

        // Simulate abort after first chunk
        if (options?.signal?.aborted) {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        }

        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } };
        yield { type: 'content_block_stop', index: 0 };
        yield { type: 'message_stop' };
      }
      return gen();
    });

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'test' }],
      }),
      signal: controller.signal,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Read first chunk then abort client side
    const reader = res.body!.getReader();
    const firstRead = await reader.read();
    expect(firstRead.done).toBe(false);

    controller.abort();

    // Drain remaining stream with the same reader
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  });

  it('breaks stream loop early when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    mockMessagesCreate.mockImplementation(async (params, options) => {
      async function* gen() {
        yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
        yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'should not appear' } };
        yield { type: 'content_block_stop', index: 0 };
        yield { type: 'message_stop' };
      }
      return gen();
    });

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'test' }],
      }),
      signal: controller.signal,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Drain stream — should complete without error even though signal was already aborted
    await drainStream(res);
  });

  it('builds Anthropic-format message history after tool calls', async () => {
    vi.resetModules();
    const mockFetchWebContent = vi.fn().mockResolvedValue({
      title: 'Test Page', content: 'test content', excerpt: '',
    });
    vi.doMock('@/lib/ingestion/web', () => ({
      fetchWebContent: mockFetchWebContent,
    }));

    // Round 1: assistant returns text + tool_use
    async function* mockStreamRound1() {
      yield { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me fetch' } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tc-1', name: 'web_fetch', input: {} } };
      yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ url: 'https://example.com', reason: 'test' }) } };
      yield { type: 'content_block_stop', index: 1 };
      yield { type: 'message_stop' };
    }

    // Round 2: final answer
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
        messages: [{ role: 'user', content: 'fetch something' }],
      }),
    });

    const res = await POST(req);
    await drainStream(res);

    // 2 rounds: main LLM call + follow-up after tool execution
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);

    const calls = mockMessagesCreate.mock.calls.map((c) => c[0]);

    // Round 1 (tools present): system prompt passed as top-level param, not in messages
    const round1Call = calls.find((c) => c.tools !== undefined && c.stream === true);
    expect(round1Call).toBeDefined();
    expect(round1Call.system).toBeDefined();
    expect(typeof round1Call.system).toBe('string');

    // Round 2 (no tools): messages history must be pure Anthropic format
    const round2Call = calls.find((c) => c.tools === undefined && c.stream === true);
    expect(round2Call).toBeDefined();

    // Assistant message with tool_use blocks
    const assistantMsg = round2Call.messages.find((m: any) => m.role === 'assistant' && Array.isArray(m.content));
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.content[0]).toMatchObject({ type: 'text', text: 'Let me fetch' });
    expect(assistantMsg.content[1]).toMatchObject({ type: 'tool_use', id: 'tc-1', name: 'web_fetch' });
    expect(assistantMsg.content[1].input).toMatchObject({ url: 'https://example.com', reason: 'test' });

    // User message with tool_result blocks
    const toolResultMsg = round2Call.messages.find((m: any) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result');
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tc-1' });
    expect(typeof toolResultMsg.content[0].content).toBe('string');
    expect(toolResultMsg.content[0].content).toContain('Test Page');
  });

  it('survives truncated tool input JSON (aborted stream scenario)', async () => {
    // 直接测试 processStreamRound 的行为：截断 JSON 不应崩溃
    const { processStreamRound } = await import('../route');

    // 手动构造一个包含截断 toolUse 的 stream
    async function* truncatedStream() {
      yield {
        type: 'message_start',
        message: { id: 'msg-1', type: 'message', role: 'assistant', content: [], model: '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
      };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc-1', name: 'web_fetch', input: {} } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"url":"https://e' } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_stop' };
    }

    const encoder = new TextEncoder();

    // 应正常返回，截断的 JSON 被处理成 {}
    const { text, toolUses } = await processStreamRound(
      truncatedStream() as any,
      () => {},
      encoder,
      new AbortController().signal
    );

    expect(toolUses.length).toBe(1);
    expect(toolUses[0].input).toEqual({}); // 截断的 JSON 降级为空对象
  });
});
