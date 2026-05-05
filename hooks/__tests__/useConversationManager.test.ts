import { describe, it, expect } from 'vitest';
import { parseMessages } from '../useConversationManager';

describe('parseMessages', () => {
  it('parses valid message data', () => {
    const data = {
      messages: [
        { id: 'm1', role: 'user', content: 'Hello', createdAt: '2024-01-01T00:00:00Z' },
        { id: 'm2', role: 'assistant', content: 'Hi', createdAt: '2024-01-01T00:00:01Z' },
      ],
    };
    const result = parseMessages(data);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'm1', role: 'user', content: 'Hello', createdAt: '2024-01-01T00:00:00Z' });
    expect(result[1]).toEqual({ id: 'm2', role: 'assistant', content: 'Hi', createdAt: '2024-01-01T00:00:01Z' });
  });

  it('generates fallback ids for messages without id', () => {
    const data = {
      messages: [
        { role: 'user', content: 'A' },
        { role: 'assistant', content: 'B' },
      ],
    };
    const result = parseMessages(data);
    expect(result[0].id).toBe('msg-0');
    expect(result[1].id).toBe('msg-1');
  });

  it('returns empty array for missing messages field', () => {
    expect(parseMessages({})).toEqual([]);
    expect(parseMessages({ messages: null })).toEqual([]);
  });

  it('returns empty array for undefined input', () => {
    expect(parseMessages(undefined as any)).toEqual([]);
  });

  it('preserves role and content fields', () => {
    const data = {
      messages: [{ role: 'assistant', content: '测试中文', createdAt: undefined }],
    };
    const result = parseMessages(data);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toBe('测试中文');
    expect(result[0].createdAt).toBeUndefined();
  });
});
