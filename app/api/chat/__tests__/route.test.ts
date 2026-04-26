import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';

const mockCreate = vi.fn();

class MockStreamingTextResponse extends Response {
  constructor(stream: ReadableStream) {
    super(stream, { headers: { 'content-type': 'text/plain' } });
  }
}

const { mockOpenAIStream, mockStreamingTextResponse } = vi.hoisted(() => ({
  mockOpenAIStream: vi.fn().mockReturnValue(new ReadableStream()),
  mockStreamingTextResponse: vi.fn().mockImplementation(function (stream: ReadableStream) {
    return new MockStreamingTextResponse(stream);
  }),
}));

vi.mock('ai', () => ({
  OpenAIStream: mockOpenAIStream,
  StreamingTextResponse: mockStreamingTextResponse,
}));

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
    mockOpenAIStream.mockClear();
    mockStreamingTextResponse.mockClear();
  });

  it('initializes OpenAI client with baseURL and apiKey', async () => {
    await import('../route');
    expect(vi.mocked(OpenAI)).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: expect.any(String),
        apiKey: expect.any(String),
      })
    );
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
    expect(mockOpenAIStream).toHaveBeenCalledWith(stream);
    expect(mockStreamingTextResponse).toHaveBeenCalled();
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
