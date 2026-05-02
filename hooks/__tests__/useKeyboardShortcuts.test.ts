import { describe, it, expect, vi } from 'vitest';
import { onCtrlEnter, onEnter } from '../useKeyboardShortcuts';

function createKeyboardEvent(init: { key: string; ctrlKey?: boolean; metaKey?: boolean }): React.KeyboardEvent {
  const prevented = { value: false };
  return {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    preventDefault: () => { prevented.value = true; },
    // expose for assertion
    _prevented: prevented,
  } as unknown as React.KeyboardEvent;
}

describe('onCtrlEnter', () => {
  it('triggers handler on Ctrl+Enter', () => {
    const handler = vi.fn();
    const keyDown = onCtrlEnter(handler);
    const e = createKeyboardEvent({ key: 'Enter', ctrlKey: true });
    keyDown(e);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((e as any)._prevented.value).toBe(true);
  });

  it('triggers handler on Meta+Enter', () => {
    const handler = vi.fn();
    const keyDown = onCtrlEnter(handler);
    const e = createKeyboardEvent({ key: 'Enter', metaKey: true });
    keyDown(e);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((e as any)._prevented.value).toBe(true);
  });

  it('does not trigger on plain Enter', () => {
    const handler = vi.fn();
    const keyDown = onCtrlEnter(handler);
    const e = createKeyboardEvent({ key: 'Enter' });
    keyDown(e);
    expect(handler).not.toHaveBeenCalled();
    expect((e as any)._prevented.value).toBe(false);
  });

  it('does not trigger on other keys', () => {
    const handler = vi.fn();
    const keyDown = onCtrlEnter(handler);
    keyDown(createKeyboardEvent({ key: 'Escape' }));
    keyDown(createKeyboardEvent({ key: 'a', ctrlKey: true }));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('onEnter', () => {
  it('triggers handler on plain Enter', () => {
    const handler = vi.fn();
    const keyDown = onEnter(handler);
    const e = createKeyboardEvent({ key: 'Enter' });
    keyDown(e);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((e as any)._prevented.value).toBe(true);
  });

  it('triggers handler on Ctrl+Enter too', () => {
    const handler = vi.fn();
    const keyDown = onEnter(handler);
    const e = createKeyboardEvent({ key: 'Enter', ctrlKey: true });
    keyDown(e);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((e as any)._prevented.value).toBe(true);
  });

  it('does not trigger on other keys', () => {
    const handler = vi.fn();
    const keyDown = onEnter(handler);
    keyDown(createKeyboardEvent({ key: 'Escape' }));
    keyDown(createKeyboardEvent({ key: 'a' }));
    expect(handler).not.toHaveBeenCalled();
  });
});
