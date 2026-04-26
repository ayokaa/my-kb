import { describe, it, expect, vi } from 'vitest';

vi.mock('openai', () => ({
  default: vi.fn(function () {
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(new ReadableStream()),
        },
      },
    };
  }),
}));

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function () {
    return {
      getRoot: vi.fn().mockReturnValue('/tmp/kb-test'),
      listNotes: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/lib/search/engine', () => ({
  search: vi.fn().mockReturnValue([]),
  assembleContext: vi.fn().mockReturnValue(''),
}));

vi.mock('@/lib/search/inverted-index', () => ({
  buildIndex: vi.fn().mockReturnValue(new Map()),
  deserializeIndex: vi.fn().mockReturnValue(null),
}));

vi.mock('ai', () => ({
  OpenAIStream: vi.fn().mockReturnValue(new ReadableStream()),
  StreamingTextResponse: vi.fn().mockImplementation((stream) => {
    return new Response(stream, { headers: { 'content-type': 'text/plain' } });
  }),
}));

describe('/api/chat validation', () => {
  it('returns 400 for empty messages array', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid messages');
  });

  it('returns 400 for invalid message role', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'hacker', content: 'x' }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid messages');
  });

  it('returns 400 for empty content', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: '' }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid messages');
  });

  it('returns 400 for non-array messages', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: 'not an array' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
