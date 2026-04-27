import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../route';

const mockAddController = vi.hoisted(() => vi.fn());
const mockRemoveController = vi.hoisted(() => vi.fn());

vi.mock('@/lib/events', () => ({
  addNoteEventController: mockAddController,
  removeNoteEventController: mockRemoveController,
}));

describe('/api/events', () => {
  beforeEach(() => {
    mockAddController.mockClear();
    mockRemoveController.mockClear();
  });

  it('returns SSE response with correct headers', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Connection')).toBe('keep-alive');
  });

  it('registers controller on stream start', async () => {
    await GET();
    expect(mockAddController).toHaveBeenCalledTimes(1);
  });

  it('sends initial heartbeat through stream', async () => {
    const res = await GET();
    const stream = res.body as ReadableStream;
    const reader = stream.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain(':ok');
    reader.releaseLock();
  });

  it('removes controller on stream cancel', async () => {
    const res = await GET();
    const stream = res.body as ReadableStream;
    const reader = stream.getReader();
    await reader.cancel();
    expect(mockRemoveController).toHaveBeenCalledTimes(1);
  });
});
