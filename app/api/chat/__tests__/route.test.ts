import { describe, it, expect } from 'vitest';
import { POST } from '../route';

describe('/api/chat', () => {
  it('returns a readable stream', async () => {
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.body).toBeInstanceOf(ReadableStream);
  });

  it('streams mock content', async () => {
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Test question' }],
      }),
    });

    const res = await POST(req);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let chunks = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += decoder.decode(value, { stream: true });
    }

    // Parse SSE format: 0:"char"\n
    for (const line of chunks.split('\n')) {
      if (line.startsWith('0:')) {
        fullText += JSON.parse(line.slice(2));
      }
    }

    expect(fullText).toContain('Test question');
    expect(fullText).toContain('Mock 回答');
    expect(chunks).toContain('finishReason');
  });
});
