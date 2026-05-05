'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useMemoryFlush } from './useMemoryFlush';

/* ── 共享类型 ── */

export interface ConversationItem {
  id: string;
  title: string;
  updatedAt: string;
  turnCount: number;
}

export interface SourceNote {
  id: string;
  title: string;
  score: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
}

export function parseMessages(data: any): ChatMessage[] {
  return (data?.messages || []).map((m: any, i: number) => ({
    id: m.id || `msg-${i}`,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
  }));
}

/* ── Hook 返回类型 ── */

export interface UseConversationManagerReturn {
  conversations: ConversationItem[];
  activeId: string | null;
  convMessages: Record<string, ChatMessage[]>;
  currentSources: SourceNote[];
  confirmingDeleteId: string | null;
  ready: boolean;
  streamingIds: Set<string>;
  handleNewConversation: () => void;
  handleSelectConversation: (id: string) => void;
  handleDeleteConversation: (id: string) => void;
  handleSave: (id: string, messages: ChatMessage[]) => void;
  handleStreamStateChange: (convId: string, streaming: boolean) => void;
  setCurrentSources: React.Dispatch<React.SetStateAction<SourceNote[]>>;
}

/* ── Hook ── */

export function useConversationManager(): UseConversationManagerReturn {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [convMessages, setConvMessages] = useState<Record<string, ChatMessage[]>>({});
  const [currentSources, setCurrentSources] = useState<SourceNote[]>([]);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const lastNewConvTimeRef = useRef(0);
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<ConversationItem[]>([]);
  const convMessagesRef = useRef<Record<string, ChatMessage[]>>({});
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());
  activeIdRef.current = activeId;
  conversationsRef.current = conversations;
  convMessagesRef.current = convMessages;

  const { stageMemoryUpdate, flushMemoryUpdate } = useMemoryFlush();

  const handleNewConversationRef = useRef<() => void>(() => {
    console.warn('[useConversationManager] handleNewConversation 尚未初始化就被调用');
  });

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations', { cache: 'no-store' });
      const data = await res.json();
      const list: ConversationItem[] = (data.conversations || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        turnCount: c.turnCount || 0,
      }));
      setConversations(list);

      if (list.length === 0 && !initializedRef.current) {
        initializedRef.current = true;
        await handleNewConversationRef.current();
        return;
      }

      // Phase 1: 立即加载活跃会话的消息（失败不阻塞 UI）
      const activeConvId = activeIdRef.current || list[0]?.id;
      if (activeConvId) {
        try {
          const msgRes = await fetch(`/api/conversations/${activeConvId}`, { cache: 'no-store' });
          if (!msgRes.ok) {
            console.error(`加载消息失败 ${activeConvId}: HTTP ${msgRes.status}`);
            setConvMessages((prev) => ({ ...prev, [activeConvId]: [] }));
          } else {
            const msgData = await msgRes.json();
            setConvMessages((prev) => ({ ...prev, [activeConvId]: parseMessages(msgData) }));
          }
        } catch (err) {
          console.error(`加载消息失败 ${activeConvId}: 网络错误`, err);
          setConvMessages((prev) => ({ ...prev, [activeConvId]: [] }));
        }
        if (!activeIdRef.current) {
          setActiveId(activeConvId);
        }
      }

      // 非活跃会话不预加载消息——切换时按需加载
    } catch (err) {
      console.error('加载会话列表失败', err);
    }
  // handleNewConversation 通过 ref 获取最新引用，避免循环依赖
  }, []);

  const initializedRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadConversations().finally(() => setReady(true));
  }, [loadConversations]);

  // 兜底：列表非空但没有活跃会话时，自动选第一个
  useEffect(() => {
    if (conversations.length > 0 && !activeId) {
      setActiveId(conversations[0].id);
    }
  }, [conversations, activeId]);

  // 组件卸载时 flush 当前会话记忆
  useEffect(() => {
    return () => {
      flushMemoryUpdate(activeIdRef.current);
    };
  }, [flushMemoryUpdate]);

  // ── handleStreamStateChange ──
  const handleStreamStateChange = useCallback((convId: string, streaming: boolean) => {
    setStreamingIds((prev) => {
      if (streaming && prev.has(convId)) return prev;
      if (!streaming && !prev.has(convId)) return prev;
      const next = new Set(prev);
      if (streaming) next.add(convId);
      else next.delete(convId);
      return next;
    });
  }, []);

  // ── 新建对话（即时切换 UI，API 在后台持久化）──
  const handleNewConversation = useCallback(() => {
    const now = Date.now();
    if (now - lastNewConvTimeRef.current < 300) {
      console.debug('[useConversationManager] 新建对话被防抖拦截 (<300ms)');
      return;
    }
    lastNewConvTimeRef.current = now;

    flushMemoryUpdate(activeIdRef.current);
    const prevActiveId = activeIdRef.current;

    const newId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.info(`[useConversationManager] 新建对话 id=${newId}, prev=${prevActiveId || '(无)'}`);
    const newConv: ConversationItem = {
      id: newId,
      title: '新对话',
      updatedAt: new Date().toISOString(),
      turnCount: 0,
    };

    setConversations((prev) => [newConv, ...prev]);
    setConvMessages((prev) => ({ ...prev, [newId]: [] }));
    setActiveId(newId);
    setCurrentSources([]);

    // 后台持久化（fire-and-forget，失败时回退）
    fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: newId, title: '新对话' }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!data.ok) {
          console.error('创建对话失败', data.error);
          setConversations((prev) => prev.filter((c) => c.id !== newId));
          setConvMessages((prev) => { const next = { ...prev }; delete next[newId]; return next; });
          setActiveId((current) => (current === newId ? prevActiveId : current));
        }
      })
      .catch((err) => {
        console.error('创建对话失败', err);
        setConversations((prev) => prev.filter((c) => c.id !== newId));
        setConvMessages((prev) => { const next = { ...prev }; delete next[newId]; return next; });
        setActiveId((current) => (current === newId ? prevActiveId : current));
      });
  }, [flushMemoryUpdate]);
  handleNewConversationRef.current = handleNewConversation;

  // ── 切换对话 ──
  const handleSelectConversation = useCallback(
    (id: string) => {
      flushMemoryUpdate(activeIdRef.current);
      setActiveId(id);
      setCurrentSources([]);
      // 按需加载：如果该会话消息尚未加载，异步获取
      if (!convMessagesRef.current[id]) {
        fetch(`/api/conversations/${id}`, { cache: 'no-store' })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json();
              setConvMessages((prev) => ({ ...prev, [id]: parseMessages(data) }));
            } else {
              setConvMessages((prev) => ({ ...prev, [id]: [] }));
            }
          })
          .catch((err) => {
            console.error(`按需加载消息失败 ${id}`, err);
            setConvMessages((prev) => ({ ...prev, [id]: [] }));
          });
      }
    },
    [flushMemoryUpdate]
  );

  // ── 删除对话 ──
  const handleDeleteConversation = useCallback(
    async (id: string) => {
      if (confirmingDeleteId !== id) {
        setConfirmingDeleteId(id);
        setTimeout(() => setConfirmingDeleteId((current) => (current === id ? null : current)), 3000);
        return;
      }
      setConfirmingDeleteId(null);

      // 标记已删除，防止后续 handleSave 重建文件
      deletedIdsRef.current.add(id);

      if (activeId === id) {
        flushMemoryUpdate(activeId);
      }
      try {
        const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setConversations((prev) => {
            const next = prev.filter((c) => c.id !== id);
            if (activeId === id) {
              if (next.length > 0) {
                setActiveId(next[0].id);
              } else {
                setActiveId(null);
                setCurrentSources([]);
              }
            }
            return next;
          });
          setConvMessages((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
      } catch (err) {
        console.error('删除对话失败', err);
        // API 失败时恢复，允许后续保存
        deletedIdsRef.current.delete(id);
      }
      // 延迟清理，确保 unmount cleanup 不会重建文件
      setTimeout(() => {
        deletedIdsRef.current.delete(id);
      }, 5000);
    },
    [activeId, confirmingDeleteId, flushMemoryUpdate]
  );

  // ── 保存对话（不再检查 activeId，每个会话独立保存）──
  const handleSave = useCallback(
    async (id: string, messages: ChatMessage[]) => {
      // 已删除的会话不再保存，避免重建文件
      if (deletedIdsRef.current.has(id)) {
        console.warn(`[useConversationManager] 跳过保存: 会话 ${id} 已被删除`);
        return;
      }
      stageMemoryUpdate(id, messages);
      try {
        const res = await fetch(`/api/conversations/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
        });
        if (!res.ok) {
          console.error(`[useConversationManager] 保存失败 ${id}: HTTP ${res.status}`);
          return;
        }
        console.debug(`[useConversationManager] 已保存 ${id}: ${messages.length} 条消息`);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === id
              ? { ...c, turnCount: messages.length, updatedAt: new Date().toISOString() }
              : c
          )
        );
      } catch (err) {
        console.error('保存对话失败', err);
      }
    },
    [stageMemoryUpdate]
  );

  return {
    ready,
    conversations,
    activeId,
    convMessages,
    currentSources,
    confirmingDeleteId,
    streamingIds,
    handleNewConversation,
    handleSelectConversation,
    handleDeleteConversation,
    handleSave,
    handleStreamStateChange,
    setCurrentSources,
  };
}
