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

describe('/api/chat', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('streams response via OpenAI SDK', async () => {
    // Simulate a streamed SSE response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    mockCreate.mockResolvedValueOnce(stream);

    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: '你好' }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
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
});
