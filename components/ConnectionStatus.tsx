'use client';

import { useSSE } from '@/hooks/useSSE';
import { useState, useCallback } from 'react';

export default function ConnectionStatus() {
  const [connected, setConnected] = useState(false);

  const handleConnectionChange = useCallback((c: boolean) => {
    setConnected(c);
  }, []);

  useSSE({ onConnectionChange: handleConnectionChange });

  const dotColor = connected
    ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]'
    : 'bg-amber-400 animate-pulse shadow-[0_0_6px_rgba(251,191,36,0.4)]';
  const label = connected ? '已连接' : '重连中';

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] text-[var(--text-tertiary)]">
      <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
      <span>{label}</span>
    </div>
  );
}
