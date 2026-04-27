import { describe, it, expect, vi } from 'vitest';
import {
  broadcastNoteChanged,
  addNoteEventController,
  removeNoteEventController,
} from '../events';

describe('events', () => {
  function createMockController(): ReadableStreamDefaultController {
    return {
      enqueue: vi.fn(),
      close: vi.fn(),
      desiredSize: 1,
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController;
  }

  it('adds and removes controller', () => {
    const c1 = createMockController();
    addNoteEventController(c1);
    broadcastNoteChanged();
    expect(c1.enqueue).toHaveBeenCalledTimes(1);

    removeNoteEventController(c1);
    broadcastNoteChanged();
    expect(c1.enqueue).toHaveBeenCalledTimes(1); // no more calls
  });

  it('broadcasts to multiple controllers', () => {
    const c1 = createMockController();
    const c2 = createMockController();
    addNoteEventController(c1);
    addNoteEventController(c2);

    broadcastNoteChanged();
    expect(c1.enqueue).toHaveBeenCalledTimes(1);
    expect(c2.enqueue).toHaveBeenCalledTimes(1);

    // Verify message format
    const msg = new TextEncoder().encode('data: changed\n\n');
    expect((c1.enqueue as any).mock.calls[0][0]).toEqual(msg);
  });

  it('removes dead controller on broadcast failure', () => {
    const good = createMockController();
    const bad = createMockController();
    bad.enqueue = vi.fn(() => {
      throw new Error('connection closed');
    });

    addNoteEventController(good);
    addNoteEventController(bad);

    broadcastNoteChanged();
    expect(good.enqueue).toHaveBeenCalledTimes(1);
    expect(bad.enqueue).toHaveBeenCalledTimes(1);

    // After bad controller threw, it should be removed
    broadcastNoteChanged();
    expect(good.enqueue).toHaveBeenCalledTimes(2);
    expect(bad.enqueue).toHaveBeenCalledTimes(1); // still 1, not called again
  });

  it('does not throw when broadcasting with no controllers', () => {
    expect(() => broadcastNoteChanged()).not.toThrow();
  });
});
