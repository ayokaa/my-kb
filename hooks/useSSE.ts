'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { NoteEvent, TaskEvent, InboxEvent } from '@/lib/events';

interface UseSSEOptions {
  onNote?: (e: NoteEvent) => void;
  onTask?: (e: TaskEvent) => void;
  onInbox?: (e: InboxEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
}

interface UseSSEReturn {
  connected: boolean | null;  // null = 初始连接中
  reconnect: () => void;
}

const INITIAL_DELAY = 1000;
const MAX_DELAY = 30000;
const BACKOFF_FACTOR = 2;

export function useSSE(options: UseSSEOptions): UseSSEReturn {
  const [connected, setConnected] = useState<boolean | null>(null);
  const retryDelay = useRef(INITIAL_DELAY);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const cleanupRef = useRef(false);
  // 保持回调引用稳定，避免 Effect 重复触发
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connect = useCallback(() => {
    if (cleanupRef.current) return;

    const source = new EventSource('/api/events');
    sourceRef.current = source;

    source.onopen = () => {
      setConnected(true);
      retryDelay.current = INITIAL_DELAY;
      optionsRef.current.onConnectionChange?.(true);
    };

    source.addEventListener('note', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as NoteEvent;
        optionsRef.current.onNote?.(data);
      } catch { /* ignore malformed events */ }
    });

    source.addEventListener('task', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as TaskEvent;
        optionsRef.current.onTask?.(data);
      } catch { /* ignore malformed events */ }
    });

    source.addEventListener('inbox', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as InboxEvent;
        optionsRef.current.onInbox?.(data);
      } catch { /* ignore malformed events */ }
    });

    source.onerror = () => {
      source.close();
      setConnected(false);
      optionsRef.current.onConnectionChange?.(false);

      if (!cleanupRef.current) {
        retryTimer.current = setTimeout(() => {
          connect();
          retryDelay.current = Math.min(retryDelay.current * BACKOFF_FACTOR, MAX_DELAY);
        }, retryDelay.current);
      }
    };
  }, []);

  const reconnect = useCallback(() => {
    retryDelay.current = INITIAL_DELAY;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    connect();
  }, [connect]);

  useEffect(() => {
    cleanupRef.current = false;
    connect();

    return () => {
      cleanupRef.current = true;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };
  }, [connect]);

  return { connected, reconnect };
}
