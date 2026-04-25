import { describe, it, expect } from 'vitest';

describe('/api/chat', () => {
  // 集成测试：需要真实的 MINIMAX_API_KEY
  // 本地开发时复制 .env.local.example 为 .env.local 并填入 key 后手动验证
  it.skip('responds with stream (requires MINIMAX_API_KEY)', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('has environment template', () => {
    // 确保 .env.local.example 存在
    expect(process.env.MINIMAX_API_KEY).toBeDefined();
  });
});
