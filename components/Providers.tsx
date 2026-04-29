'use client';

import { type ReactNode } from 'react';
import { ToastProvider } from '@/hooks/ToastContext';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      {children}
    </ToastProvider>
  );
}
