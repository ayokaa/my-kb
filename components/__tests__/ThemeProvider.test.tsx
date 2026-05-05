import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import ThemeProvider, { useTheme } from '../ThemeProvider';

function TestConsumer() {
  const { theme, toggle } = useTheme();
  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <button data-testid="theme-toggle" onClick={toggle}>
        切换
      </button>
    </div>
  );
}

function stubMatchMedia(matchesLight: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: light)' ? matchesLight : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    stubMatchMedia(false); // default prefers dark
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults to dark on server-like first render (no localStorage)', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    expect(getByTestId('theme-value').textContent).toBe('dark');
  });

  it('reads theme from localStorage', () => {
    localStorage.setItem('theme', 'light');

    const { getByTestId } = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    expect(getByTestId('theme-value').textContent).toBe('light');
  });

  it('reads theme from DOM attribute (set by inline script before hydration)', () => {
    document.documentElement.setAttribute('data-theme', 'light');

    const { getByTestId } = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    expect(getByTestId('theme-value').textContent).toBe('light');
  });

  it('DOM attribute takes precedence over localStorage', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'light');

    const { getByTestId } = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    expect(getByTestId('theme-value').textContent).toBe('dark');
  });

  it('toggle switches from dark to light and back', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    const toggle = getByTestId('theme-toggle');

    act(() => { toggle.click(); });
    expect(getByTestId('theme-value').textContent).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');

    act(() => { toggle.click(); });
    expect(getByTestId('theme-value').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('persists theme to localStorage on change', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    act(() => { getByTestId('theme-toggle').click(); });
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('updates document data-theme attribute on change', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    act(() => { getByTestId('theme-toggle').click(); });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('rejects invalid localStorage value', () => {
    localStorage.setItem('theme', 'invalid');

    const { getByTestId } = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    // Falls back to system preference or dark
    expect(['dark', 'light']).toContain(getByTestId('theme-value').textContent);
  });
});
