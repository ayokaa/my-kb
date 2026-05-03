'use client';

import { useRef, useCallback } from 'react';

export interface MemoryMessage {
  role: string;
  content: string;
  createdAt?: string;
}

export interface MemoryFlushResult {
  flushed: boolean;
  conversationId: string;
  messageCount: number;
}

/**
 * 管理对话记忆的缓存与刷新。
 * 设计为在对话结束时（切换、新建、删除、卸载）统一触发记忆更新。
 */
export function useMemoryFlush() {
  const pendingMemoryRef = useRef<Set<string>>(new Set());
  const lastMessagesRef = useRef<Record<string, MemoryMessage[]>>({});

  /**
   * 将一组消息标记为待更新记忆。
   * 通常在收到 assistant 完整回复后调用。
   */
  const stageMemoryUpdate = useCallback((id: string, messages: MemoryMessage[]) => {
    if (!id) return;
    pendingMemoryRef.current.add(id);
    lastMessagesRef.current[id] = messages;
    console.log(`[MemoryFlush] staged conversation=${id}, messages=${messages.length}`);
  }, []);

  /**
   * 立即 flush 指定对话的记忆更新。
   * 返回本次是否实际发起了请求。
   */
  const flushMemoryUpdate = useCallback((id: string | null): MemoryFlushResult => {
    if (!id) {
      console.log('[MemoryFlush] skipped: no conversation id');
      return { flushed: false, conversationId: '', messageCount: 0 };
    }

    const hasPending = pendingMemoryRef.current.has(id);
    const messages = lastMessagesRef.current[id];

    if (!hasPending) {
      console.log(`[MemoryFlush] skipped: conversation=${id} has no pending memory`);
    } else if (!messages || messages.length < 2) {
      console.log(`[MemoryFlush] skipped: conversation=${id} has only ${messages?.length ?? 0} messages`);
    } else {
      console.log(`[MemoryFlush] flushing conversation=${id}, messages=${messages.length}`);
      fetch('/api/memory/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: id, messages }),
      })
        .then(() => {
          console.log(`[MemoryFlush] success: conversation=${id}`);
        })
        .catch((err) => {
          console.error(`[MemoryFlush] failed: conversation=${id}`, err);
        });
      pendingMemoryRef.current.delete(id);
      delete lastMessagesRef.current[id];
      return { flushed: true, conversationId: id, messageCount: messages.length };
    }

    // 清理残留标记
    pendingMemoryRef.current.delete(id);
    delete lastMessagesRef.current[id];
    return { flushed: false, conversationId: id, messageCount: messages?.length ?? 0 };
  }, []);

  return { stageMemoryUpdate, flushMemoryUpdate, pendingMemoryRef, lastMessagesRef };
}
