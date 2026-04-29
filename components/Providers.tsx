'use client';

import { type ReactNode } from 'react';
import { ToastProvider } from '@/hooks/ToastContext';
import ConnectionStatus from './ConnectionStatus';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <ConnectionStatus />
    </ToastProvider>
  );
}
