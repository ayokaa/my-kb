import { describe, it, expect } from 'vitest';

describe('/api/chat', () => {
  const hasKey = !!process.env.MINIMAX_API_KEY;

  it.skipIf(!hasKey)('calls real MiniMax API and streams response', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: '你好，请自我介绍' }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');

    // 读取流确认有内容返回
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let hasContent = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk.includes('0:')) hasContent = true;
    }

    expect(hasContent).toBe(true);
  }, 30000);

  it.skipIf(!hasKey)('environment variable is defined', () => {
    expect(process.env.MINIMAX_API_KEY).toBeDefined();
  });
});
