import { describe, it, expect, vi } from 'vitest';
import {
  broadcastNoteChanged,
  addNoteEventController,
  removeNoteEventController,
  emitNoteEvent,
  emitTaskEvent,
  emitInboxEvent,
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

  describe('emitNoteEvent', () => {
    it('emits SSE-formatted note event with correct structure', () => {
      const c = createMockController();
      addNoteEventController(c);

      emitNoteEvent('created', 'note-1', 'AI Agents');

      const msg = new TextDecoder().decode((c.enqueue as any).mock.calls[0][0]);
      expect(msg).toContain('event: note');
      expect(msg).toContain('"action":"created"');
      expect(msg).toContain('"id":"note-1"');
      expect(msg).toContain('"title":"AI Agents"');
      expect(msg).toMatch(/event: note\ndata: .+\n\n$/);
    });

    it('supports updated and deleted actions', () => {
      const c = createMockController();
      addNoteEventController(c);

      emitNoteEvent('deleted', 'note-2', 'Old Title');

      const msg = new TextDecoder().decode((c.enqueue as any).mock.calls[0][0]);
      expect(msg).toContain('"action":"deleted"');
    });
  });

  describe('emitTaskEvent', () => {
    it('emits SSE-formatted task event', () => {
      const c = createMockController();
      addNoteEventController(c);

      emitTaskEvent('completed', 'task-123', 'ingest', undefined, { ok: true });

      const msg = new TextDecoder().decode((c.enqueue as any).mock.calls[0][0]);
      expect(msg).toContain('event: task');
      expect(msg).toContain('"action":"completed"');
      expect(msg).toContain('"id":"task-123"');
      expect(msg).toContain('"type":"ingest"');
      expect(msg).toContain('"ok":true');
    });

    it('includes error in failed task event', () => {
      const c = createMockController();
      addNoteEventController(c);

      emitTaskEvent('failed', 'task-456', 'web_fetch', 'Timeout');

      const msg = new TextDecoder().decode((c.enqueue as any).mock.calls[0][0]);
      expect(msg).toContain('"action":"failed"');
      expect(msg).toContain('"error":"Timeout"');
    });

    it('does not include error field when no error', () => {
      const c = createMockController();
      addNoteEventController(c);

      emitTaskEvent('completed', 'task-1', 'relink');

      const msg = new TextDecoder().decode((c.enqueue as any).mock.calls[0][0]);
      expect(msg).not.toContain('"error"');
    });
  });

  describe('emitInboxEvent', () => {
    it('emits SSE-formatted inbox event', () => {
      const c = createMockController();
      addNoteEventController(c);

      emitInboxEvent('new', 5);

      const msg = new TextDecoder().decode((c.enqueue as any).mock.calls[0][0]);
      expect(msg).toContain('event: inbox');
      expect(msg).toContain('"action":"new"');
      expect(msg).toContain('"count":5');
    });

    it('allows count to be omitted', () => {
      const c = createMockController();
      addNoteEventController(c);

      emitInboxEvent('new');

      const msg = new TextDecoder().decode((c.enqueue as any).mock.calls[0][0]);
      expect(msg).toContain('event: inbox');
      // count 字段在 omit 后不应该出现
      const data = JSON.parse(msg.split('\n')[1].slice(6));
      expect(data.count).toBeUndefined();
    });
  });

  describe('SSE format correctness', () => {
    it('emits valid JSON in data field', () => {
      const c = createMockController();
      addNoteEventController(c);

      emitNoteEvent('created', 'n1', 'Test');

      const msg = new TextDecoder().decode((c.enqueue as any).mock.calls[0][0]);
      const lines = msg.split('\n');
      const dataLine = lines.find((l: string) => l.startsWith('data: '))!;
      const payload = JSON.parse(dataLine.slice(6));
      expect(payload).toEqual({ action: 'created', id: 'n1', title: 'Test' });
    });

    it('ends with double newline', () => {
      const c = createMockController();
      addNoteEventController(c);

      emitTaskEvent('started', 't1', 'ingest');

      const msg = new TextDecoder().decode((c.enqueue as any).mock.calls[0][0]);
      expect(msg.endsWith('\n\n')).toBe(true);
    });
  });
});
