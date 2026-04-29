'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  duration?: number;
}

interface ToastContextValue {
  show: (message: string, type?: Toast['type'], duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: Toast['type'] = 'info', duration = 4000) => {
    const id = `toast-${++nextId}`;
    setToasts((prev) => [...prev.slice(-4), { id, type, message, duration }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  const typeStyles: Record<Toast['type'], string> = {
    success: 'border-[var(--accent)]/30 bg-emerald-950/80 text-emerald-300',
    error: 'border-red-500/30 bg-red-950/80 text-red-300',
    info: 'border-[var(--border)] bg-[var(--bg-elevated)]/95 text-[var(--text-primary)]',
  };

  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-50 flex flex-col-reverse gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={`pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-md transition-all animate-in slide-in-from-right-4 ${typeStyles[t.type]}`}
        >
          <span className="flex-1">{t.message}</span>
        </button>
      ))}
    </div>
  );
}
