'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from 'ai/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileText,
  Link,
  Rss,
  Upload,
  Bot,
  User,
  Plus,
  MessageSquare,
  BookOpen,
  Sparkles,
  Trash2,
} from 'lucide-react';

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
  const savedRef = useRef(false);
  const pendingQueueRef = useRef<string[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);

  const { messages, input, handleInputChange, handleSubmit, isLoading, data, setMessages, append } = useChat({
    id: conversationId,
    initialMessages: initialMessages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    body: {},
    onFinish: () => {
      if (conversationId && !savedRef.current) {
        savedRef.current = true;
        // Defer save to next tick so messages are fully updated
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
      // Process queued messages
      setTimeout(() => {
        if (pendingQueueRef.current.length > 0) {
          const next = pendingQueueRef.current.shift();
          setQueuedMessages((prev) => prev.slice(1));
          if (next) {
            append({ role: 'user', content: next });
          }
        }
      }, 50);
    },
  });

  // Reset save flag when conversation changes
  useEffect(() => {
    savedRef.current = false;
  }, [conversationId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Extract sources from stream data
  useEffect(() => {
    if (data && data.length > 0) {
      for (const item of data) {
        if (Array.isArray(item)) {
          for (const d of item) {
            if (d && d.type === 'sources' && Array.isArray(d.notes)) {
              setSources(d.notes);
              onSources(d.notes);
            }
          }
        }
      }
    }
  }, [data, onSources]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    savedRef.current = false;
    if (!input.trim()) return;

    if (isLoading) {
      // Queue the message
      pendingQueueRef.current.push(input);
      setQueuedMessages((prev) => [...prev, input]);
      handleInputChange({ target: { value: '' } } as any);
      return;
    }

    handleSubmit(e);
  };

  return (
    <>
      {/* Messages */}
      <div className="mb-4 flex flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-dim)]">
              <Bot className="h-8 w-8 text-[var(--accent)]" />
            </div>
            <p className="font-[family-name:var(--font-serif)] text-xl font-semibold tracking-wide text-[var(--text-primary)]">
              知识库助手
            </p>
            <p className="mt-1 text-sm text-[var(--text-tertiary)]">基于已有知识回答你的问题</p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex max-w-[82%] gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  m.role === 'user' ? 'bg-[var(--accent)]' : 'bg-[var(--bg-elevated)] border border-[var(--border)]'
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
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ node, ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--accent)] underline transition-opacity hover:opacity-80" />
                        ),
                        p: ({ node, ...props }) => <p {...props} className="mb-2 last:mb-0" />,
                        h1: ({ node, ...props }) => <h1 {...props} className="mb-2 mt-3 text-lg font-semibold" />,
                        h2: ({ node, ...props }) => <h2 {...props} className="mb-2 mt-2 text-base font-semibold" />,
                        h3: ({ node, ...props }) => <h3 {...props} className="mb-1 mt-2 text-sm font-semibold" />,
                        ul: ({ node, ...props }) => <ul {...props} className="mb-2 ml-4 list-disc" />,
                        ol: ({ node, ...props }) => <ol {...props} className="mb-2 ml-4 list-decimal" />,
                        li: ({ node, ...props }) => <li {...props} className="mb-0.5" />,
                        code: ({ node, className, children, ...props }: any) => {
                          const isInline = !className;
                          return isInline ? (
                            <code className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-xs" {...props}>
                              {children}
                            </code>
                          ) : (
                            <pre className="my-2 overflow-x-auto rounded-lg bg-[var(--bg-hover)] p-3 font-mono text-xs break-words">
                              <code className={className} {...props}>{children}</code>
                            </pre>
                          );
                        },
                        blockquote: ({ node, ...props }) => <blockquote {...props} className="my-2 border-l-2 border-[var(--accent)] pl-3 italic opacity-80" />,
                        strong: ({ node, ...props }) => <strong {...props} className="font-semibold" />,
                        hr: ({ node, ...props }) => <hr {...props} className="my-3 border-[var(--border)]" />,
                        table: ({ node, ...props }) => <table {...props} className="mb-2 w-full text-xs" />,
                        th: ({ node, ...props }) => <th {...props} className="border border-[var(--border)] bg-[var(--bg-hover)] px-2 py-1 text-left font-semibold" />,
                        td: ({ node, ...props }) => <td {...props} className="border border-[var(--border)] px-2 py-1" />,
                      }}
                    >
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
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-tertiary)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                思考中...
              </div>
            </div>
          </div>
        )}

        {/* Queued messages */}
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
      <form onSubmit={onSubmit} className="flex gap-3">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="问点什么..."
          aria-label="聊天输入"
          className="input-dark flex-1 px-4 py-3.5 text-sm"
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
  );
}

export default function ChatPanel() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([]);
  const [currentSources, setCurrentSources] = useState<SourceNote[]>([]);
  const [loadingConv, setLoadingConv] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const [showIngest, setShowIngest] = useState(false);
  const [ingestTab, setIngestTab] = useState<'text' | 'link' | 'file' | 'rss'>('text');
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult, setIngestResult] = useState('');
  const [textInput, setTextInput] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [rssUrl, setRssUrl] = useState('');
  const [rssName, setRssName] = useState('');

  // Load conversation list
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations', { cache: 'no-store' });
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch (err) {
      console.error('[ChatPanel] Failed to load conversations:', err);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Load messages when switching conversations
  const loadMessages = useCallback(async (id: string) => {
    if (!id) return;
    setLoadingConv(true);
    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        setActiveMessages(
          (data.messages || []).map((m: any, i: number) => ({
            id: m.id || `msg-${i}`,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          }))
        );
      }
    } catch (err) {
      console.error('[ChatPanel] Failed to load messages:', err);
    } finally {
      setLoadingConv(false);
    }
  }, []);

  const handleSelectConversation = useCallback(
    async (id: string) => {
      setActiveId(id);
      setCurrentSources([]);
      await loadMessages(id);
    },
    [loadMessages]
  );

  const handleNewConversation = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '新对话' }),
      });
      const data = await res.json();
      if (data.ok) {
        setConversations((prev) => [data.conversation, ...prev]);
        setActiveId(data.conversation.id);
        setActiveMessages([]);
        setCurrentSources([]);
      }
    } catch (err) {
      console.error('[ChatPanel] Failed to create conversation:', err);
    }
  }, []);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      if (confirmingDeleteId !== id) {
        setConfirmingDeleteId(id);
        // Auto-cancel after 3s
        setTimeout(() => {
          setConfirmingDeleteId((current) => (current === id ? null : current));
        }, 3000);
        return;
      }
      setConfirmingDeleteId(null);
      try {
        const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setConversations((prev) => {
            const next = prev.filter((c) => c.id !== id);
            if (activeId === id) {
              if (next.length > 0) {
                handleSelectConversation(next[0].id);
              } else {
                setActiveId(null);
                setActiveMessages([]);
                setCurrentSources([]);
              }
            }
            return next;
          });
        }
      } catch (err) {
        console.error('[ChatPanel] Failed to delete conversation:', err);
      }
    },
    [activeId, confirmingDeleteId, handleSelectConversation]
  );

  const handleSave = useCallback(
    async (id: string, messages: Array<{ role: string; content: string; createdAt?: string }>) => {
      try {
        await fetch(`/api/conversations/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
        });
        loadConversations();
      } catch (err) {
        console.error('[ChatPanel] Failed to save conversation:', err);
      }
    },
    [loadConversations]
  );

  // Auto-create first conversation on initial mount only (not after deletion)
  const hasAutoCreated = useRef(false);
  useEffect(() => {
    if (!hasAutoCreated.current && conversations.length === 0 && !activeId && !loadingConv) {
      hasAutoCreated.current = true;
      handleNewConversation();
    }
  }, [conversations, activeId, loadingConv, handleNewConversation]);



  async function submitIngest(type: string, body: object) {
    setIngestLoading(true);
    setIngestResult('');
    try {
      const res = await fetch(type === 'file' ? '/api/upload' : type === 'rss' ? '/api/rss' : '/api/ingest', {
        method: 'POST',
        headers: type === 'file' ? undefined : { 'Content-Type': 'application/json' },
        body: type === 'file' ? (body as any) : JSON.stringify(body),
      });
      const data = await res.json();
      setIngestResult(data.ok ? `已入库 · ${data.title || data.count || 'success'}` : `失败 · ${data.error}`);
    } catch (err: any) {
      setIngestResult(`错误 · ${err.message}`);
    }
    setIngestLoading(false);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    await submitIngest('file', formData);
  }

  const tabs = [
    { id: 'text' as const, label: '文本', icon: FileText },
    { id: 'link' as const, label: '链接', icon: Link },
    { id: 'file' as const, label: '文件', icon: Upload },
    { id: 'rss' as const, label: 'RSS', icon: Rss },
  ];

  return (
    <div className="flex h-full gap-4">
      {/* Conversation List Sidebar */}
      <div className="flex w-56 flex-col gap-3">
        <div className="flex-1 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-2">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-[var(--text-tertiary)]">
              <MessageSquare className="h-6 w-6 opacity-40" />
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
                  <button
                    onClick={() => handleSelectConversation(conv.id)}
                    className="flex flex-1 items-center gap-2 px-3 py-2.5 text-left text-xs"
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="flex-1 truncate font-medium">{conv.title}</span>
                    {conv.turnCount > 0 && (
                      <span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
                        {conv.turnCount}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConversation(conv.id);
                    }}
                    aria-label={confirmingDeleteId === conv.id ? '确认删除' : '删除对话'}
                    title={confirmingDeleteId === conv.id ? '确认删除' : '删除对话'}
                    className={`mr-1.5 flex items-center gap-1 rounded px-1.5 py-1 text-[10px] transition-all ${
                      confirmingDeleteId === conv.id
                        ? 'bg-red-900/30 text-[var(--error)] opacity-100'
                        : 'p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-900/20 hover:text-[var(--error)]'
                    }`}
                  >
                    <Trash2 className="h-3 w-3" />
                    {confirmingDeleteId === conv.id && <span>确认</span>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col">
        {/* Ingest Panel */}
        <div className="mb-4 card-elevated overflow-hidden">
          <button
            data-testid="ingest-toggle"
            onClick={() => setShowIngest(!showIngest)}
            className="flex w-full items-center gap-2 px-5 py-3.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            {showIngest ? (
              <ChevronDown className="h-4 w-4 text-[var(--accent)]" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />
            )}
            <span className="font-[family-name:var(--font-serif)] text-base tracking-wide">添加知识</span>
            <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Ingest</span>
          </button>

          {showIngest && (
            <div className="border-t border-[var(--border)] px-5 pb-5 pt-3">
              <div className="mb-4 flex gap-1">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      data-testid={`ingest-tab-${tab.id}`}
                      onClick={() => setIngestTab(tab.id)}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-all ${
                        ingestTab === tab.id
                          ? 'bg-[var(--accent)] text-[var(--bg-primary)]'
                          : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {ingestTab === 'text' && (
                <div className="space-y-3">
                  <input
                    placeholder="标题（可选）"
                    value={textTitle}
                    onChange={(e) => setTextTitle(e.target.value)}
                    className="input-dark w-full px-3 py-2.5 text-sm"
                  />
                  <textarea
                    placeholder="输入文本内容..."
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    rows={3}
                    className="input-dark w-full px-3 py-2.5 text-sm resize-none"
                  />
                  <button
                    onClick={() => {
                      submitIngest('text', { type: 'text', title: textTitle, content: textInput });
                      setTextInput('');
                      setTextTitle('');
                    }}
                    disabled={ingestLoading || !textInput.trim()}
                    className="btn-primary px-4 py-2 text-xs disabled:opacity-40"
                  >
                    {ingestLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '入库'}
                  </button>
                </div>
              )}

              {ingestTab === 'link' && (
                <div className="flex gap-2">
                  <input
                    placeholder="https://..."
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    className="input-dark flex-1 px-3 py-2.5 text-sm"
                  />
                  <button
                    onClick={() => {
                      submitIngest('link', { type: 'link', url: linkUrl });
                      setLinkUrl('');
                    }}
                    disabled={ingestLoading || !linkUrl.trim()}
                    className="btn-primary px-4 py-2 text-xs disabled:opacity-40"
                  >
                    {ingestLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '抓取'}
                  </button>
                </div>
              )}

              {ingestTab === 'file' && (
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-[var(--border-hover)] px-4 py-6 text-sm text-[var(--text-tertiary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-secondary)]">
                    <Upload className="h-4 w-4" />
                    <span>点击或拖拽上传文件</span>
                    <input
                      type="file"
                      accept=".pdf,.md,.txt,.markdown,application/pdf,text/plain,text/markdown"
                      aria-label="上传文件"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">支持 PDF、Markdown、TXT</p>
                </div>
              )}

              {ingestTab === 'rss' && (
                <div className="space-y-3">
                  <input
                    placeholder="RSS 名称（可选）"
                    value={rssName}
                    onChange={(e) => setRssName(e.target.value)}
                    className="input-dark w-full px-3 py-2.5 text-sm"
                  />
                  <div className="flex gap-2">
                    <input
                      placeholder="https://example.com/feed.xml"
                      value={rssUrl}
                      onChange={(e) => setRssUrl(e.target.value)}
                      className="input-dark flex-1 px-3 py-2.5 text-sm"
                    />
                    <button
                      onClick={() => {
                        submitIngest('rss', { url: rssUrl, name: rssName });
                        setRssUrl('');
                        setRssName('');
                      }}
                      disabled={ingestLoading || !rssUrl.trim()}
                      className="btn-primary px-4 py-2 text-xs disabled:opacity-40"
                    >
                      {ingestLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '抓取'}
                    </button>
                  </div>
                </div>
              )}

              {ingestResult && (
                <p
                  className={`mt-3 rounded-md px-3 py-2 text-xs ${
                    ingestResult.startsWith('已') ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'bg-red-900/20 text-[var(--error)]'
                  }`}
                >
                  {ingestResult}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Chat Messages */}
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
            <MessageSquare className="h-10 w-10 opacity-40" />
            <p className="text-sm">点击「新对话」开始聊天</p>
          </div>
        )}
      </div>
    </div>
  );
}
