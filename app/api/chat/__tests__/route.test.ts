import { describe, it, expect, vi } from 'vitest';

const mockCreate = vi.fn();

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



describe('/api/chat', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('streams response with filtered think tags', async () => {
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

});
