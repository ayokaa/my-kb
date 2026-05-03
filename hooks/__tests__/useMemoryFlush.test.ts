import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMemoryFlush } from '../useMemoryFlush';

describe('useMemoryFlush', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stages a memory update for a conversation', () => {
    const { result } = renderHook(() => useMemoryFlush());

    result.current.stageMemoryUpdate('conv-1', [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);

    expect(result.current.pendingMemoryRef.current.has('conv-1')).toBe(true);
    expect(result.current.lastMessagesRef.current['conv-1']).toHaveLength(2);
    expect(consoleLogSpy).toHaveBeenCalledWith('[MemoryFlush] staged conversation=conv-1, messages=2');
  });

  it('skips flush when id is null', () => {
    const { result } = renderHook(() => useMemoryFlush());

    const r = result.current.flushMemoryUpdate(null);

    expect(r.flushed).toBe(false);
    expect(r.conversationId).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('[MemoryFlush] skipped: no conversation id');
  });

  it('skips flush when conversation has no pending memory', () => {
    const { result } = renderHook(() => useMemoryFlush());

    const r = result.current.flushMemoryUpdate('conv-1');

    expect(r.flushed).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('[MemoryFlush] skipped: conversation=conv-1 has no pending memory');
  });

  it('skips flush when conversation has fewer than 2 messages', () => {
    const { result } = renderHook(() => useMemoryFlush());

    result.current.stageMemoryUpdate('conv-1', [{ role: 'user', content: 'hi' }]);
    const r = result.current.flushMemoryUpdate('conv-1');

    expect(r.flushed).toBe(false);
    expect(r.messageCount).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('[MemoryFlush] skipped: conversation=conv-1 has only 1 messages');
  });

  it('flushes memory when conversation has 2+ messages', () => {
    const { result } = renderHook(() => useMemoryFlush());
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];

    result.current.stageMemoryUpdate('conv-1', messages);
    const r = result.current.flushMemoryUpdate('conv-1');

    expect(r.flushed).toBe(true);
    expect(r.conversationId).toBe('conv-1');
    expect(r.messageCount).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/memory/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', messages }),
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('[MemoryFlush] flushing conversation=conv-1, messages=2');
  });

  it('clears pending state after flush', () => {
    const { result } = renderHook(() => useMemoryFlush());

    result.current.stageMemoryUpdate('conv-1', [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    result.current.flushMemoryUpdate('conv-1');

    // 再次 flush 应该因为无 pending 而跳过
    const r2 = result.current.flushMemoryUpdate('conv-1');
    expect(r2.flushed).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // 只有第一次调了 fetch
  });

  it('logs success after fetch resolves', async () => {
    const { result } = renderHook(() => useMemoryFlush());

    result.current.stageMemoryUpdate('conv-1', [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    result.current.flushMemoryUpdate('conv-1');

    // 等待 microtask
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 10));

    expect(consoleLogSpy).toHaveBeenCalledWith('[MemoryFlush] success: conversation=conv-1');
  });

  it('logs error after fetch rejects', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useMemoryFlush());

    result.current.stageMemoryUpdate('conv-1', [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    result.current.flushMemoryUpdate('conv-1');

    // 等待 microtask
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 10));

    expect(consoleErrorSpy).toHaveBeenCalledWith('[MemoryFlush] failed: conversation=conv-1', expect.any(Error));
  });

  it('handles multiple conversations independently', () => {
    const { result } = renderHook(() => useMemoryFlush());

    result.current.stageMemoryUpdate('conv-1', [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
    result.current.stageMemoryUpdate('conv-2', [
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ]);

    result.current.flushMemoryUpdate('conv-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    result.current.flushMemoryUpdate('conv-2');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
