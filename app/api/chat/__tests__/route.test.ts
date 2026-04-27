import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockFetchWebContent = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn(function () {
    return {
      chat: {
        completions: {
          create: mockCreate,
        },
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

vi.mock('@/lib/ingestion/web', () => ({
  fetchWebContent: mockFetchWebContent,
}));

vi.mock('@/lib/search/cache', () => ({
  loadOrBuildIndex: vi.fn().mockResolvedValue({ entries: [] }),
}));



describe('/api/chat', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockFetchWebContent.mockReset();
  });

  it('streams response with filtered think tags', async () => {
    // 第一次调用: stream: false (工具检测)
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '' } }],
    });

    // Simulate OpenAI async iterable response
    async function* mockStream() {
      yield { choices: [{ delta: { content: 'Hello ' } }] };
      yield { choices: [{ delta: { content: '<think>some reasoning' } }] };
      yield { choices: [{ delta: { content: ' inside think</think>' } }] };
      yield { choices: [{ delta: { content: ' world' } }] };
    }

    mockCreate.mockResolvedValueOnce(mockStream());

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

    // Read the stream
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
    // 第一次调用: stream: false (工具检测)
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '' } }],
    });

    async function* mockStream() {
      yield { choices: [{ delta: { content: 'Start ' } }] };
      yield { choices: [{ delta: { content: '<think>' } }] };
      yield { choices: [{ delta: { content: 'hidden' } }] };
      yield { choices: [{ delta: { content: '</think>' } }] };
      yield { choices: [{ delta: { content: ' End' } }] };
    }

    mockCreate.mockResolvedValueOnce(mockStream());

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
    mockFetchWebContent.mockResolvedValue({
      title: 'Internal', content: 'secret data', excerpt: '',
    });

    // LLM returns a tool call targeting internal URL
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'tc-1',
            function: {
              name: 'web_fetch',
              arguments: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/', reason: 'test' }),
            },
          }],
        },
      }],
    });

    // Second call: streaming the final answer
    async function* mockStream() {
      yield { choices: [{ delta: { content: 'Done' } }] };
    }
    mockCreate.mockResolvedValueOnce(mockStream());

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'fetch internal' }],
      }),
    });

    await POST(req);
    // fetchWebContent must NOT be called for internal URLs
    expect(mockFetchWebContent).not.toHaveBeenCalled();
  });

  it('limits concurrent tool calls to 3', async () => {
    mockFetchWebContent.mockResolvedValue({
      title: 'Page', content: 'content', excerpt: '',
    });

    // LLM returns 5 tool calls
    const toolCalls = Array.from({ length: 5 }, (_, i) => ({
      id: `tc-${i}`,
      function: {
        name: 'web_fetch',
        arguments: JSON.stringify({ url: `https://example.com/page-${i}`, reason: 'test' }),
      },
    }));

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '', tool_calls: toolCalls } }],
    });

    async function* mockStream() {
      yield { choices: [{ delta: { content: 'Done' } }] };
    }
    mockCreate.mockResolvedValueOnce(mockStream());

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'fetch many' }],
      }),
    });

    await POST(req);
    // fetchWebContent should be called at most 3 times, not 5
    expect(mockFetchWebContent).toHaveBeenCalledTimes(3);
  });

});
