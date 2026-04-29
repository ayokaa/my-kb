import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate, mockSaveMemory, mockEvolveStatuses } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockSaveMemory: vi.fn(),
  mockEvolveStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(function () {
    return { messages: { create: mockCreate } };
  }),
}));

vi.mock('@/lib/memory', () => ({
  loadMemory: vi.fn().mockResolvedValue({
    profile: { techStack: [], interests: [] },
    noteKnowledge: {},
    conversationDigest: [],
    preferences: {},
    updatedAt: '',
  }),
  saveMemory: mockSaveMemory,
  mergeMemory: vi.fn((current, extracted) => ({ ...current, ...extracted })),
  evolveNoteStatuses: mockEvolveStatuses,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { POST } from '../route';

/** 等待 queueMicrotask 中的后台处理完成 */
async function flushMicrotasks() {
  await new Promise((resolve) => queueMicrotask(resolve));
  // 再等待多个 tick，确保 async/await 链（loadMemory → getLLMClient → messages.create）全部完成
  // 在完整测试套件中 CPU 可能被其他测试占用，需要更长的等待时间
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('POST /api/memory/update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ conversationDigest: { summary: '测试对话', topics: ['test'] } }) }],
    });
  });

  it('rejects invalid JSON body', async () => {
    const req = new Request('http://localhost/api/memory/update', {
      method: 'POST',
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    await flushMicrotasks(); // 清理可能残留的 microtask
  });

  it('returns not enough messages if messages array is missing', async () => {
    const req = new Request('http://localhost/api/memory/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', messages: [] }),
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.reason).toBe('not enough messages');
    await flushMicrotasks(); // 清理可能残留的 microtask
  });

  it('returns immediately with queued=true and processes in background', async () => {
    const req = new Request('http://localhost/api/memory/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'conv-1',
        messages: [
          { role: 'user', content: '什么是 RAG？' },
          { role: 'assistant', content: 'RAG 是检索增强生成...' },
        ],
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    // 立即返回，不等待 LLM
    expect(data.ok).toBe(true);
    expect(data.queued).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();

    // 等待后台处理完成
    await flushMicrotasks();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSaveMemory).toHaveBeenCalledTimes(1);
    expect(mockEvolveStatuses).toHaveBeenCalledTimes(1);
  });

  it('handles LLM returning malformed JSON gracefully in background', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json at all' }],
    });

    const req = new Request('http://localhost/api/memory/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'conv-1',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    // 立即返回成功，后台会处理错误
    expect(data.ok).toBe(true);
    expect(data.queued).toBe(true);

    // 后台处理时遇到 parse error，不会抛到前端
    await flushMicrotasks();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSaveMemory).not.toHaveBeenCalled();
    vi.clearAllMocks(); // 清理，防止影响后续测试
  });

  it('handles LLM API failure gracefully in background', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API rate limit'));

    const req = new Request('http://localhost/api/memory/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'conv-1',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    // 立即返回成功，后台会处理错误
    expect(data.ok).toBe(true);
    expect(data.queued).toBe(true);

    // 后台处理时遇到 API 错误，不会抛到前端
    await flushMicrotasks();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it('works without conversationId', async () => {
    const req = new Request('http://localhost/api/memory/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      }),
    });

    const res = await POST(req);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.queued).toBe(true);

    await flushMicrotasks();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
