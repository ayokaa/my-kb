import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '../route';

const mockLoadConversation = vi.hoisted(() => vi.fn());
const mockSaveConversation = vi.hoisted(() => vi.fn());

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function () {
    return {
      loadConversation: mockLoadConversation,
      saveConversation: mockSaveConversation,
    };
  }),
}));

describe('/api/conversations/[id]', () => {
  beforeEach(() => {
    mockLoadConversation.mockReset();
    mockSaveConversation.mockReset();
  });

  it('loads a conversation', async () => {
    mockLoadConversation.mockResolvedValue({
      id: 'conv-1',
      date: '2024-01-01',
      topics: ['Test Topic'],
      status: 'open',
      turns: [
        { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
        { role: 'agent', content: 'Hi there', timestamp: '2024-01-01T00:00:01Z' },
      ],
      agentActions: [],
    });

    const res = await GET(new Request('http://localhost/api/conversations/conv-1'), { params: Promise.resolve({ id: 'conv-1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe('Test Topic');
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0].role).toBe('user');
    expect(data.messages[1].role).toBe('assistant');
  });

  it('returns 404 for missing conversation', async () => {
    mockLoadConversation.mockRejectedValue(new Error('not found'));

    const res = await GET(new Request('http://localhost/api/conversations/missing'), { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });

  it('saves messages to an existing conversation', async () => {
    mockLoadConversation.mockResolvedValue({
      id: 'conv-1',
      date: '2024-01-01',
      topics: ['Old Topic'],
      status: 'open',
      turns: [],
      agentActions: [],
    });
    mockSaveConversation.mockResolvedValue(undefined);

    const req = new Request('http://localhost/api/conversations/conv-1', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Hello', createdAt: '2024-01-01T00:00:00Z' },
          { role: 'assistant', content: 'Hi', createdAt: '2024-01-01T00:00:01Z' },
        ],
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'conv-1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('returns 404 when saving to a non-existent conversation', async () => {
    const err: any = new Error('ENOENT: no such file');
    err.code = 'ENOENT';
    mockLoadConversation.mockRejectedValue(err);

    const req = new Request('http://localhost/api/conversations/missing', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Hello', createdAt: '2024-01-01T00:00:00Z' },
        ],
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid messages', async () => {
    const req = new Request('http://localhost/api/conversations/conv-1', {
      method: 'POST',
      body: JSON.stringify({ messages: 'not-array' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'conv-1' }) });
    expect(res.status).toBe(400);
  });
});
