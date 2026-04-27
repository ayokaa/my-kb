import { describe, it, expect, vi } from 'vitest';
import { GET, POST } from '../route';

const mockListConversations = vi.hoisted(() => vi.fn());
const mockSaveConversation = vi.hoisted(() => vi.fn());

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function () {
    return {
      listConversations: mockListConversations,
      saveConversation: mockSaveConversation,
    };
  }),
}));

describe('/api/conversations', () => {
  beforeEach(() => {
    mockListConversations.mockReset();
    mockSaveConversation.mockReset();
  });

  it('lists conversations', async () => {
    mockListConversations.mockResolvedValue([
      { id: 'conv-1', date: '2024-01-01', topics: ['Test'], status: 'open', turns: [], agentActions: [], updatedAt: '2024-01-01T00:00:00Z' },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversations).toHaveLength(1);
    expect(data.conversations[0].title).toBe('Test');
    expect(data.conversations[0].id).toBe('conv-1');
  });

  it('creates a new conversation', async () => {
    mockSaveConversation.mockResolvedValue(undefined);

    const req = new Request('http://localhost/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 'New Chat' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.conversation.title).toBe('New Chat');
    expect(data.conversation.id).toMatch(/^conv-/);
  });

  it('creates conversation with default title', async () => {
    mockSaveConversation.mockResolvedValue(undefined);

    const req = new Request('http://localhost/api/conversations', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const data = await res.json();
    expect(data.conversation.title).toBe('新对话');
  });

  it('returns 500 on list error', async () => {
    mockListConversations.mockRejectedValue(new Error('disk error'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
