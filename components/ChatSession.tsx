'use client';

import { useState, useEffect, useRef } from 'react';
import { useChat } from 'ai/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Loader2, Bot, User, Plus, BookOpen, Sparkles } from 'lucide-react';
import { onCtrlEnter } from '@/hooks/useKeyboardShortcuts';
import { serializeMessages } from '@/lib/utils';
import type { Components } from 'react-markdown';
import type { ChatMessage, SourceNote } from '@/hooks/useConversationManager';

/** 模块级 ReactMarkdown components，避免每次渲染重建 */
const markdownComponents: Components = {
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-[var(--accent)] underline transition-opacity hover:opacity-80"
    />
  ),
  p: ({ node: _node, ...props }) => <p {...props} className="mb-2 last:mb-0" />,
  h1: ({ node: _node, ...props }) => <h1 {...props} className="mb-2 mt-3 text-lg font-semibold" />,
  h2: ({ node: _node, ...props }) => <h2 {...props} className="mb-2 mt-2 text-base font-semibold" />,
  h3: ({ node: _node, ...props }) => <h3 {...props} className="mb-1 mt-2 text-sm font-semibold" />,
  ul: ({ node: _node, ...props }) => <ul {...props} className="mb-2 ml-4 list-disc" />,
  ol: ({ node: _node, ...props }) => <ol {...props} className="mb-2 ml-4 list-decimal" />,
  li: ({ node: _node, ...props }) => <li {...props} className="mb-0.5" />,
  code: ({ node, className, children, ...props }: any) => {
    const isInline = !className;
    return isInline ? (
      <code className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-xs" {...props}>
        {children}
      </code>
    ) : (
      <pre className="my-2 overflow-x-auto rounded-lg bg-[var(--bg-hover)] p-3 font-mono text-xs break-words">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      {...props}
      className="my-2 rounded-r-lg border-l-2 border-[var(--accent)] bg-[var(--accent-dim)] py-2 pl-3 pr-3 text-[var(--text-secondary)]"
    />
  ),
  strong: ({ node: _node, ...props }) => <strong {...props} className="font-semibold" />,
  hr: ({ node: _node, ...props }) => <hr {...props} className="my-3 border-[var(--border)]" />,
  table: ({ node: _node, ...props }) => <table {...props} className="mb-2 w-full text-xs" />,
  th: ({ node: _node, ...props }) => (
    <th {...props} className="border border-[var(--border)] bg-[var(--bg-hover)] px-2 py-1 text-left font-semibold" />
  ),
  td: ({ node: _node, ...props }) => (
    <td {...props} className="border border-[var(--border)] px-2 py-1" />
  ),
};

export interface ChatSessionProps {
  conversationId: string;
  initialMessages: ChatMessage[];
  isActive: boolean;
  onSources: (sources: SourceNote[]) => void;
  onSave: (id: string, messages: ChatMessage[]) => void;
  onNewConversation: () => void;
  /** 通知父组件 stream 状态变化，用于控制 keep-alive */
  onStreamStateChange?: (convId: string, streaming: boolean) => void;
}

export default function ChatSession({
  conversationId,
  initialMessages,
  isActive,
  onSources,
  onSave,
  onNewConversation,
  onStreamStateChange,
}: ChatSessionProps) {
  const [sources, setSources] = useState<SourceNote[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queueIdRef = useRef(0);
  const pendingQueueRef = useRef<Array<{ id: string; text: string }>>([]);
  const [queuedMessages, setQueuedMessages] = useState<Array<{ id: string; text: string }>>([]);

  const convIdRef = useRef(conversationId);
  useEffect(() => {
    convIdRef.current = conversationId;
  }, [conversationId]);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    data,
    append,
    error,
    setMessages,
  } = useChat({
    id: conversationId,
    initialMessages: [],
    body: {},
    streamProtocol: 'data',
    onError: (err) => {
      console.error(`聊天出错: ${err.message}`);
    },
    onFinish: () => {
      setTimeout(() => {
        if (pendingQueueRef.current.length > 0) {
          const next = pendingQueueRef.current.shift();
          setQueuedMessages((prev) => prev.slice(1));
          if (next) append({ role: 'user', content: next.text });
        }
      }, 50);
    },
  });

  const hasSyncedRef = useRef(false);
  useEffect(() => {
    if (!hasSyncedRef.current && initialMessages.length > 0) {
      hasSyncedRef.current = true;
      setMessages(
        initialMessages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        }))
      );
    }
  }, [initialMessages, setMessages]);

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const wasLoadingRef = useRef(false);
  const messagesForSaveRef = useRef(messages);
  useEffect(() => {
    messagesForSaveRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && convIdRef.current) {
      if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
        onSaveRef.current(convIdRef.current, serializeMessages(messages));
      }
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, messages]);

  const onStreamStateChangeRef = useRef(onStreamStateChange);
  onStreamStateChangeRef.current = onStreamStateChange;
  useEffect(() => {
    if (isLoading) {
      console.debug(`[ChatSession] stream 开始: ${conversationId}`);
    }
    onStreamStateChangeRef.current?.(conversationId, isLoading);
  }, [isLoading, conversationId]);

  useEffect(() => {
    return () => {
      const msgs = messagesForSaveRef.current;
      if (msgs.length > 0) {
        onSaveRef.current(convIdRef.current, serializeMessages(msgs));
      }
      onStreamStateChangeRef.current?.(convIdRef.current, false);
    };
  }, []);

  useEffect(() => {
    if (isActive) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, isActive]);

  const lastDataLenRef = useRef(0);
  useEffect(() => {
    if (data && data.length > lastDataLenRef.current) {
      for (let i = lastDataLenRef.current; i < data.length; i++) {
        const item = data[i];
        if (Array.isArray(item)) {
          for (const d of item) {
            const obj = d as Record<string, any>;
            if (obj && obj.type === 'sources' && Array.isArray(obj.notes)) {
              setSources(obj.notes);
              if (isActive) {
                onSources(obj.notes);
              }
            }
          }
        }
      }
      lastDataLenRef.current = data.length;
    }
  }, [data, onSources, isActive]);

  useEffect(() => {
    if (isActive && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isActive]);

  const onSubmit = (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!input.trim()) return;
    if (isLoading) {
      const qId = `q-${++queueIdRef.current}`;
      pendingQueueRef.current.push({ id: qId, text: input });
      setQueuedMessages((prev) => [...prev, { id: qId, text: input }]);
      handleInputChange({ target: { value: '' } } as React.ChangeEvent<HTMLTextAreaElement>);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }
    handleSubmit(e as React.FormEvent<HTMLFormElement>);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${isActive ? '' : 'hidden'}`}>
      {!isActive ? null : (
      <>
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
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  m.role === 'user'
                    ? 'bg-[var(--accent)]'
                    : 'bg-[var(--bg-elevated)] border border-[var(--border)]'
                }`}
              >
                {m.role === 'user' ? (
                  <User className="h-3.5 w-3.5 text-[var(--bg-primary)]" />
                ) : (
                  <Bot className="h-3.5 w-3.5 text-[var(--accent)]" />
                )}
              </div>
              <div
                className={`px-4 py-3 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'rounded-2xl rounded-br-md bg-[var(--accent)] text-[var(--bg-primary)]'
                    : 'rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                }`}
              >
                {m.role === 'assistant' ? (
                  <div className="markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
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
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-tertiary)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  思考中...
                </div>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="flex justify-start">
            <div className="flex gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--error)] bg-red-900/20">
                <Bot className="h-3.5 w-3.5 text-[var(--error)]" />
              </div>
              <div className="rounded-2xl rounded-bl-md border border-[var(--error)] bg-red-900/10 px-4 py-3 text-sm text-[var(--error)]">
                {error.message}
              </div>
            </div>
          </div>
        )}

        {queuedMessages.length > 0 && (
          <div className="flex flex-col gap-2">
            {queuedMessages.map((q) => (
              <div key={q.id} className="flex justify-end">
                <div className="flex max-w-[82%] flex-row-reverse gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]">
                    <User className="h-3.5 w-3.5 text-[var(--bg-primary)]" />
                  </div>
                  <div className="rounded-2xl rounded-br-md bg-[var(--accent)] px-4 py-3 text-sm text-[var(--bg-primary)] opacity-60">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] opacity-70">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      排队中
                    </div>
                    <div className="whitespace-pre-wrap break-words">{q.text}</div>
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
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)]"
                title={`相关度: ${s.score.toFixed(2)}`}
              >
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
        <button
          type="button"
          aria-label="新对话"
          title="新对话"
          onClick={onNewConversation}
          className="flex items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3.5 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="submit"
          aria-label="发送"
          disabled={!input.trim()}
          className="btn-primary flex items-center gap-2 px-5 py-3.5 text-sm disabled:opacity-40"
        >
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
      </>
      )}
    </div>
  );
}
