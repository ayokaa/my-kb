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
  });

  it('processes valid conversation and saves memory', async () => {
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
    expect(data.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSaveMemory).toHaveBeenCalledTimes(1);
    expect(mockEvolveStatuses).toHaveBeenCalledTimes(1);
  });

  it('handles LLM returning malformed JSON gracefully', async () => {
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
    expect(data.ok).toBe(false);
    expect(data.reason).toBe('parse error');
  });

  it('handles LLM API failure', async () => {
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
    expect(data.ok).toBe(false);
    expect(data.reason).toBe('internal error');
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
  });
});
