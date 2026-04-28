import { describe, it, expect, vi } from 'vitest';
import { GET } from '../route';

const mockOnNewLog = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logger', () => ({
  logger: {
    query: mockQuery,
    onNewLog: mockOnNewLog,
  },
}));

describe('/api/logs/stream', () => {
  it('returns SSE stream with correct headers', async () => {
    mockQuery.mockReturnValue({ logs: [] });
    mockOnNewLog.mockReturnValue(() => {});

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('sends history event on connect', async () => {
    mockQuery.mockReturnValue({
      logs: [{ id: '1', level: 'info', message: 'hello' }],
    });
    mockOnNewLog.mockReturnValue(() => {});

    const res = await GET();
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);

    expect(text).toContain('event: history');
    expect(text).toContain('hello');
    reader.releaseLock();
  });
});
