'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from 'ai/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Loader2, Bot, User, Plus, MessageSquare, Trash2, BookOpen, Sparkles, Globe } from 'lucide-react';
import { useToast } from '@/hooks/ToastContext';
import { onCtrlEnter } from '@/hooks/useKeyboardShortcuts';
import { useMemoryFlush } from '@/hooks/useMemoryFlush';

interface ConversationItem {
  id: string;
  title: string;
  updatedAt: string;
  turnCount: number;
}

interface SourceNote {
  id: string;
  title: string;
  score: number;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  createdAt?: string;
}

interface ChatAreaProps {
  conversationId: string;
  initialMessages: ChatMessage[];
  onSources: (sources: SourceNote[]) => void;
  onSave: (id: string, messages: Array<{ role: string; content: string; createdAt?: string }>) => void;
  onNewConversation: () => void;
}

function ChatArea({ conversationId, initialMessages, onSources, onSave, onNewConversation }: ChatAreaProps) {
  const [sources, setSources] = useState<SourceNote[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savedRef = useRef(false);
  const pendingQueueRef = useRef<string[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [toolCalls, setToolCalls] = useState<Array<{ name: string; url: string }>>([]);

  const { messages, input, handleInputChange, handleSubmit, isLoading, data, append } = useChat({
    id: conversationId,
    initialMessages: initialMessages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    body: {},
    onFinish: () => {
      setToolCalls([]);
      if (conversationId && !savedRef.current) {
        savedRef.current = true;
        setTimeout(() => {
          const allMessages = [
            ...initialMessages.map((m) => ({
              role: m.role,
              content: m.content,
              createdAt: m.createdAt || new Date().toISOString(),
            })),
            ...messages.map((m) => ({
              role: m.role,
              content: m.content,
              createdAt: new Date().toISOString(),
            })),
          ];
          onSave(conversationId, allMessages);
        }, 100);
      }
      setTimeout(() => {
        if (pendingQueueRef.current.length > 0) {
          const next = pendingQueueRef.current.shift();
          setQueuedMessages((prev) => prev.slice(1));
          if (next) append({ role: 'user', content: next });
        }
      }, 50);
    },
  });

  useEffect(() => { savedRef.current = false; }, [conversationId]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isLoading]);

  useEffect(() => {
    if (data && data.length > 0) {
      for (const item of data) {
        if (Array.isArray(item)) {
          for (const d of item) {
            const obj = d as Record<string, any>;
            if (obj && obj.type === 'sources' && Array.isArray(obj.notes)) {
              setSources(obj.notes);
              onSources(obj.notes);
            }
            if (obj && obj.type === 'tool_call' && obj.name && obj.url) {
              setToolCalls((prev) => [...prev, { name: obj.name, url: obj.url }]);
            }
          }
        }
      }
    }
  }, [data, onSources]);

  const onSubmit = (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    savedRef.current = false;
    if (!input.trim()) return;
    if (isLoading) {
      pendingQueueRef.current.push(input);
      setQueuedMessages((prev) => [...prev, input]);
      handleInputChange({ target: { value: '' } } as React.ChangeEvent<HTMLTextAreaElement>);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }
    handleSubmit(e as React.FormEvent<HTMLFormElement>);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Messages */}
      <div className="mb-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-dim)] shadow-[0_0_40px_var(--accent-glow)]">
              <Bot className="h-8 w-8 text-[var(--accent)]" />
            </div>
            <p className="font-[family-name:var(--font-serif)] text-xl font-semibold tracking-wide text-[var(--text-primary)]">
              知识库助手
            </p>
            <p className="mt-1.5 text-sm text-[var(--text-tertiary)]">基于已有知识回答你的问题</p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex max-w-[82%] gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${m.role === 'user' ? 'bg-[var(--accent)]' : 'bg-[var(--bg-elevated)] border border-[var(--border)]'}`}>
                {m.role === 'user' ? <User className="h-3.5 w-3.5 text-[var(--bg-primary)]" /> : <Bot className="h-3.5 w-3.5 text-[var(--accent)]" />}
              </div>
              <div className={`px-4 py-3 text-sm leading-relaxed ${m.role === 'user' ? 'rounded-2xl rounded-br-md bg-[var(--accent)] text-[var(--bg-primary)]' : 'rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'}`}>
                {m.role === 'assistant' ? (
                  <div className="markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--accent)] underline transition-opacity hover:opacity-80" />, p: ({ node, ...props }) => <p {...props} className="mb-2 last:mb-0" />, h1: ({ node, ...props }) => <h1 {...props} className="mb-2 mt-3 text-lg font-semibold" />, h2: ({ node, ...props }) => <h2 {...props} className="mb-2 mt-2 text-base font-semibold" />, h3: ({ node, ...props }) => <h3 {...props} className="mb-1 mt-2 text-sm font-semibold" />, ul: ({ node, ...props }) => <ul {...props} className="mb-2 ml-4 list-disc" />, ol: ({ node, ...props }) => <ol {...props} className="mb-2 ml-4 list-decimal" />, li: ({ node, ...props }) => <li {...props} className="mb-0.5" />, code: ({ node, className, children, ...props }: any) => {
                      const isInline = !className;
                      return isInline ? <code className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-xs" {...props}>{children}</code> : <pre className="my-2 overflow-x-auto rounded-lg bg-[var(--bg-hover)] p-3 font-mono text-xs break-words"><code className={className} {...props}>{children}</code></pre>;
                    }, blockquote: ({ node, ...props }) => <blockquote {...props} className="my-2 border-l-2 border-[var(--accent)] pl-3 italic opacity-80" />, strong: ({ node, ...props }) => <strong {...props} className="font-semibold" />, hr: ({ node, ...props }) => <hr {...props} className="my-3 border-[var(--border)]" />, table: ({ node, ...props }) => <table {...props} className="mb-2 w-full text-xs" />, th: ({ node, ...props }) => <th {...props} className="border border-[var(--border)] bg-[var(--bg-hover)] px-2 py-1 text-left font-semibold" />, td: ({ node, ...props }) => <td {...props} className="border border-[var(--border)] px-2 py-1" /> }}>
                      {m.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && messages.at(-1)?.role === 'user' && (
          <div className="flex justify-start">
            <div className="flex gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
                <Bot className="h-3.5 w-3.5 text-[var(--accent)]" />
              </div>
              <div className="flex flex-col gap-1.5">
                {toolCalls.length > 0 && (
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 text-xs text-[var(--text-tertiary)]">
                    <Globe className="h-3 w-3 text-[var(--accent)]" />
                    已抓取网页:
                    {toolCalls.map((tc, i) => (
                      <span key={i} className="max-w-[200px] truncate text-[var(--accent)]">
                        {tc.url}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-tertiary)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  思考中...
                </div>
              </div>
            </div>
          </div>
        )}

        {queuedMessages.length > 0 && (
          <div className="flex flex-col gap-2">
            {queuedMessages.map((q, i) => (
              <div key={`queued-${i}`} className="flex justify-end">
                <div className="flex max-w-[82%] flex-row-reverse gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]">
                    <User className="h-3.5 w-3.5 text-[var(--bg-primary)]" />
                  </div>
                  <div className="rounded-2xl rounded-br-md bg-[var(--accent)] px-4 py-3 text-sm text-[var(--bg-primary)] opacity-60">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] opacity-70">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      排队中
                    </div>
                    <div className="whitespace-pre-wrap break-words">{q}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span className="text-xs font-medium text-[var(--text-primary)]">知识来源</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {sources.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)]" title={`相关度: ${s.score.toFixed(2)}`}>
                <Sparkles className="h-2.5 w-2.5 text-[var(--accent)]" />
                {s.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={onSubmit} className="flex items-end gap-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            handleInputChange(e);
            const el = textareaRef.current;
            if (el) {
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
            }
          }}
          onKeyDown={onCtrlEnter(() => onSubmit())}
          placeholder="问点什么..."
          aria-label="聊天输入"
          rows={1}
          className="input-dark flex-1 resize-none px-4 py-3.5 text-sm max-h-[200px]"
        />
        <button type="button" aria-label="新对话" title="新对话" onClick={onNewConversation} className="flex items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3.5 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
          <Plus className="h-4 w-4" />
        </button>
        <button type="submit" aria-label="发送" disabled={!input.trim()} className="btn-primary flex items-center gap-2 px-5 py-3.5 text-sm disabled:opacity-40">
          {isLoading ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {queuedMessages.length > 0 && <span className="text-[10px]">+{queuedMessages.length}</span>}
            </span>
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </form>
    </div>
  );
}

export default function ChatPanel() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([]);
  const [currentSources, setCurrentSources] = useState<SourceNote[]>([]);
  const [loadingConv, setLoadingConv] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const { show } = useToast();

  const isCreatingRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const { stageMemoryUpdate, flushMemoryUpdate } = useMemoryFlush();

  const handleNewConversation = useCallback(async () => {
    if (isCreatingRef.current) return;
    // 结束当前会话后再创建新对话
    flushMemoryUpdate(activeIdRef.current);
    isCreatingRef.current = true;
    try {
      const res = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '新对话' }) });
      const data = await res.json();
      if (data.ok) {
        setConversations((prev) => [data.conversation, ...prev]);
        setActiveId(data.conversation.id);
        setActiveMessages([]);
        setCurrentSources([]);
      }
    } catch {
      show('创建对话失败', 'error');
    } finally {
      isCreatingRef.current = false;
    }
  }, [flushMemoryUpdate, show]);

  const initializedRef = useRef(false);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations', { cache: 'no-store' });
      const data = await res.json();
      const list = data.conversations || [];
      setConversations(list);
      if (list.length === 0 && !initializedRef.current) {
        initializedRef.current = true;
        await handleNewConversation();
      } else if (list.length > 0 && !activeIdRef.current) {
        setActiveId(list[0].id);
      }
    } catch {
      show('加载对话列表失败', 'error');
    }
  }, [handleNewConversation]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    return () => {
      // 组件卸载时 flush 当前会话的记忆
      flushMemoryUpdate(activeIdRef.current);
    };
  }, [flushMemoryUpdate]);

  const loadMessages = useCallback(async (id: string) => {
    if (!id) return;
    setLoadingConv(true);
    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        setActiveMessages((data.messages || []).map((m: any, i: number) => ({ id: m.id || `msg-${i}`, role: m.role, content: m.content, createdAt: m.createdAt })));
      }
    } catch {
      show('加载消息失败', 'error');
    } finally {
      setLoadingConv(false);
    }
  }, []);

  const handleSelectConversation = useCallback(async (id: string) => {
    // 离开当前会话前触发记忆更新
    flushMemoryUpdate(activeIdRef.current);
    setActiveId(id);
    setCurrentSources([]);
    await loadMessages(id);
  }, [loadMessages, flushMemoryUpdate]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      setTimeout(() => setConfirmingDeleteId((current) => (current === id ? null : current)), 3000);
      return;
    }
    setConfirmingDeleteId(null);
    // 删除前若当前会话有未更新的记忆，先 flush
    if (activeId === id) {
      flushMemoryUpdate(activeId);
    }
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConversations((prev) => {
          const next = prev.filter((c) => c.id !== id);
          if (activeId === id) {
            if (next.length > 0) handleSelectConversation(next[0].id);
            else { setActiveId(null); setActiveMessages([]); setCurrentSources([]); }
          }
          return next;
        });
      }
      show('对话已删除', 'info');
    } catch {
      show('删除对话失败', 'error');
    }
  }, [activeId, confirmingDeleteId, handleSelectConversation, flushMemoryUpdate]);

  const handleSave = useCallback(async (id: string, messages: Array<{ role: string; content: string; createdAt?: string }>) => {
    // 缓存最新消息，等会话结束时统一更新记忆
    stageMemoryUpdate(id, messages);
    try {
      await fetch(`/api/conversations/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
      loadConversations();
    } catch {
      show('保存对话失败', 'error');
    }
  }, [loadConversations, show, stageMemoryUpdate]);



  return (
    <div className="flex h-full gap-4 overflow-hidden">
      {/* Conversation List Sidebar */}
      <div className="flex h-full w-52 flex-col gap-3">
        {/* New Conversation Button */}
        <button
          onClick={handleNewConversation}
          className="btn-primary flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium"
        >
          <Plus className="h-4 w-4" />
          新对话
        </button>

        <div className="flex-1 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-2">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-[var(--text-tertiary)]">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-dim)]">
                <MessageSquare className="h-5 w-5 text-[var(--accent)] opacity-60" />
              </div>
              <p className="mt-2 text-xs">还没有对话</p>
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`group flex items-center gap-1 rounded-lg transition-all ${
                    activeId === conv.id
                      ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <button onClick={() => handleSelectConversation(conv.id)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-xs">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="flex-1 truncate font-medium">{conv.title}</span>
                    {conv.turnCount > 0 && (
                      <span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">{conv.turnCount}</span>
                    )}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                    aria-label={confirmingDeleteId === conv.id ? '确认删除' : '删除对话'}
                    title={confirmingDeleteId === conv.id ? '确认删除' : '删除对话'}
                    className={`mr-1.5 shrink-0 flex items-center gap-1 rounded px-1.5 py-1 text-[10px] transition-all ${
                      confirmingDeleteId === conv.id
                        ? 'bg-red-900/30 text-[var(--error)] opacity-100'
                        : 'p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-900/20 hover:text-[var(--error)]'
                    }`}
                  >
                    <Trash2 className="h-3 w-3 shrink-0" />
                    {confirmingDeleteId === conv.id && <span className="shrink-0">确认</span>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        {activeId ? (
          <ChatArea
            key={activeId}
            conversationId={activeId}
            initialMessages={activeMessages}
            onSources={setCurrentSources}
            onSave={handleSave}
            onNewConversation={handleNewConversation}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--text-tertiary)]">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-dim)]">
              <MessageSquare className="h-7 w-7 text-[var(--accent)] opacity-60" />
            </div>
            <p className="text-sm">点击「新对话」开始聊天</p>
          </div>
        )}
      </div>
    </div>
  );
}
