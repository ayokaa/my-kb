'use client';

import { useState, useMemo, useCallback } from 'react';
import { useSSE } from '@/hooks/useSSE';
import { useToast } from '@/hooks/ToastContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen,
  Search,
  Calendar,
  Tag,
  Link2,
  Clock,
  Lightbulb,
  HelpCircle,
  FileText,
  ChevronRight,
  RefreshCw,
  ArrowUpRight,
  Trash2,
  Loader2,
  CornerUpLeft,
} from 'lucide-react';

import type { Note } from '@/lib/types';

const STATUS_CONFIG: Record<
  Note['status'],
  { label: string; bg: string; text: string; border: string }
> = {
  seed: {
    label: '种子',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/20',
  },
  growing: {
    label: '生长中',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/20',
  },
  evergreen: {
    label: '常青',
    bg: 'bg-teal-500/10',
    text: 'text-teal-400',
    border: 'border-teal-500/20',
  },
  stale: {
    label: '陈旧',
    bg: 'bg-orange-500/10',
    text: 'text-orange-400',
    border: 'border-orange-500/20',
  },
  archived: {
    label: '归档',
    bg: 'bg-[var(--bg-hover)]',
    text: 'text-[var(--text-tertiary)]',
    border: 'border-[var(--border)]',
  },
};

function StatusBadge({ status }: { status: Note['status'] }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      {cfg.label}
    </span>
  );
}

interface NotesPanelClientProps {
  initialNotes: Note[];
}

export default function NotesPanelClient({ initialNotes }: NotesPanelClientProps) {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [selected, setSelected] = useState<Note | null>(initialNotes[0] || null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleteResult, setDeleteResult] = useState('');

  const { show } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notes');
      const data = await res.json();
      const list: Note[] = data.notes || [];
      setNotes((prev) => {
        // If currently selected note no longer exists, pick the next available one
        if (data.notes) {
          setSelected((current) => {
            if (!current) return list[0] || null;
            const stillExists = list.find((n) => n.id === current.id);
            if (!stillExists) {
              setConfirmingDeleteId(null);
              setDeleteResult('');
              return list[0] || null;
            }
            return current;
          });
        }
        return list;
      });
    } catch {
      show('加载笔记失败', 'error');
    }
    setLoading(false);
  }, [show]);

  function navigateToNote(title: string) {
    // 先精确匹配
    let target = notes.find((n) => n.title === title);
    // 再子串包含匹配（与链接校验逻辑一致）
    if (!target) {
      const lower = title.toLowerCase();
      target = notes.find((n) => {
        const t = n.title.toLowerCase();
        return t.includes(lower) || lower.includes(t);
      });
    }
    if (target) {
      setSelected(target);
    }
  }

  // SSE: 笔记变更时自动刷新列表
  useSSE({
    onNote: useCallback(() => { load(); }, [load]),
  });

  const handleDelete = useCallback(async (note: Note) => {
    // 第一次点击：进入确认态，3 秒后自动恢复
    if (confirmingDeleteId !== note.id) {
      setConfirmingDeleteId(note.id);
      setDeleteResult('');
      setTimeout(() => {
        setConfirmingDeleteId((current) => (current === note.id ? null : current));
      }, 3000);
      return;
    }

    // 第二次点击：执行删除
    setConfirmingDeleteId(null);
    setDeletingId(note.id);
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        show(`已删除《${note.title}》`, 'info');
        await load();
      } else {
        setDeleteResult(`删除失败 · ${data.error}`);
      }
    } catch {
      show('删除失败', 'error');
    }
    setDeletingId(null);
  }, [confirmingDeleteId, load, show]);

  const filtered = useMemo(() => {
    let result = notes;
    if (statusFilter !== 'all') {
      result = result.filter((n) => n.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q)) ||
          n.summary.toLowerCase().includes(q)
      );
    }
    return result;
  }, [notes, search, statusFilter]);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('zh-CN');
    } catch {
      return iso;
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3">
        <Search className="h-4 w-4 text-[var(--text-tertiary)]" />
        <input
          type="text"
          placeholder="搜索笔记标题、标签…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
        />
        <div className="flex gap-1.5">
          {(['all', 'seed', 'growing', 'evergreen', 'stale'] as const).map((s) => (
            <button
              key={s}
              data-testid={`note-filter-${s}`}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                statusFilter === s
                  ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                  : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {s === 'all' ? '全部' : STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>
        <button onClick={load} disabled={loading} className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent)]">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Main */}
      <div className="flex flex-1 gap-5 overflow-hidden">
        {/* List */}
        <div className="flex w-80 flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-[var(--accent)]" />
              <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold tracking-wide">笔记</h2>
              <span className="rounded-md bg-[var(--accent-dim)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                {filtered.length}
              </span>
            </div>
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto p-3">
            {filtered.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-16">
                <BookOpen className="h-8 w-8 text-[var(--text-tertiary)]" />
                <p className="mt-3 text-sm text-[var(--text-tertiary)]">
                  {notes.length === 0 ? '还没有笔记' : '无匹配结果'}
                </p>
              </div>
            )}

            {filtered.map((note) => (
              <button
                key={note.id}
                onClick={() => { setSelected(note); setConfirmingDeleteId(null); setDeleteResult(''); }}
                
                className={`w-full rounded-xl border p-4 text-left transition-all duration-200 ${
                  selected?.id === note.id
                    ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                    : 'border-transparent bg-[var(--bg-elevated)] hover:border-[var(--border-hover)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-medium text-[var(--text-primary)]">{note.title}</p>
                  <StatusBadge status={note.status} />
                </div>
                {note.summary && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-[var(--text-secondary)]">{note.summary}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {note.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]"
                    >
                      {tag}
                    </span>
                  ))}
                  {note.tags.length > 3 && (
                    <span className="text-[10px] text-[var(--text-tertiary)]">+{note.tags.length - 3}</span>
                  )}
                </div>
                <p className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                  <Calendar className="h-3 w-3" />
                  {formatDate(note.created)}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
          {selected ? (
            <div className="flex h-full flex-col">
              {/* Header */}
              <div className="border-b border-[var(--border)] px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-[family-name:var(--font-serif)] text-xl font-semibold leading-snug tracking-wide text-[var(--text-primary)]">
                      {selected.title}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--text-tertiary)]">
                      <StatusBadge status={selected.status} />
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(selected.created)}
                      </span>
                      {selected.sources.length > 0 && (
                        <span className="flex flex-wrap items-center gap-1">
                          <FileText className="h-3 w-3 shrink-0" />
                          {selected.sources.map((s, i) => (
                            <span key={i} className="flex items-center">
                              {i > 0 && <span className="mx-1">·</span>}
                              {/^https?:\/\//.test(s) ? (
                                <a
                                  href={s}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="break-all text-[var(--accent)] underline transition-opacity hover:opacity-80"
                                >
                                  {s}
                                </a>
                              ) : (
                                <span>{s}</span>
                              )}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selected.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
                        >
                          <Tag className="h-2.5 w-2.5" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => handleDelete(selected)}
                      disabled={deletingId === selected.id}
                      aria-label={confirmingDeleteId === selected.id ? '确认删除' : '删除笔记'}
                      className={`flex items-center gap-1.5 rounded px-3 py-2 text-xs transition-colors disabled:opacity-40 ${
                        confirmingDeleteId === selected.id
                          ? 'bg-red-900/30 text-[var(--error)]'
                          : 'text-[var(--text-tertiary)] hover:text-[var(--error)]'
                      }`}
                    >
                      {deletingId === selected.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      {confirmingDeleteId === selected.id ? '确认删除' : '删除'}
                    </button>
                  </div>
                </div>
                {deleteResult && (
                  <p className="mt-3 break-words rounded-md bg-red-900/20 px-3 py-2 text-xs text-[var(--error)]">
                    {deleteResult}
                  </p>
                )}
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="mx-auto max-w-3xl space-y-5">
                  {/* Summary + Personal Context */}
                  {(selected.summary || selected.personalContext) && (
                    <div className="grid gap-4 md:grid-cols-2">
                      {selected.summary && (
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                          <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                            <Lightbulb className="h-3 w-3 text-yellow-400" />
                            一句话摘要
                          </h4>
                          <p className="text-sm leading-relaxed text-[var(--text-secondary)] break-words">{selected.summary}</p>
                        </div>
                      )}
                      {selected.personalContext && (
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                          <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                            <ArrowUpRight className="h-3 w-3 text-[var(--accent)]" />
                            与我相关
                          </h4>
                          <p className="text-sm leading-relaxed text-[var(--text-secondary)] break-words">
                            {selected.personalContext}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Key Facts */}
                  {selected.keyFacts.length > 0 && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                      <h4 className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                        <FileText className="h-3 w-3 text-[var(--accent)]" />
                        关键事实
                      </h4>
                      <ul className="space-y-2">
                        {selected.keyFacts.map((fact, i) => (
                          <li key={i} className="flex gap-2 text-sm text-[var(--text-secondary)] break-words">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                            <span className="break-words">{fact}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Timeline */}
                  {selected.timeline.length > 0 && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                      <h4 className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                        <Clock className="h-3 w-3 text-[var(--accent)]" />
                        时间线
                      </h4>
                      <div className="space-y-3">
                        {selected.timeline.map((t, i) => (
                          <div key={i} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                              {i < selected.timeline.length - 1 && (
                                <div className="mt-1 h-full w-px bg-[var(--border)]" />
                              )}
                            </div>
                            <div className="pb-3">
                              <p className="text-xs font-medium text-[var(--accent)] break-words">{t.date}</p>
                              <p className="mt-0.5 text-sm text-[var(--text-secondary)] break-words">{t.event}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Links */}
                  {selected.links.length > 0 && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                      <h4 className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                        <Link2 className="h-3 w-3 text-[var(--accent)]" />
                        关联
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {selected.links.map((link, i) => (
                          <button
                            key={i}
                            onClick={() => navigateToNote(link.target)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                              link.weight === 'strong'
                                ? 'border-[var(--accent)]/30 bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent)]/20'
                                : link.weight === 'context'
                                  ? 'border-[var(--border)] bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:border-[var(--accent)]/30 hover:text-[var(--accent)]'
                                  : 'border-[var(--border)] bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:border-[var(--accent)]/30 hover:text-[var(--accent)]'
                            }`}
                          >
                            <ChevronRight className="h-3 w-3 shrink-0" />
                            <span className="break-words">{link.target}</span>
                            {link.context && (
                              <span className="text-[10px] opacity-60 break-words">— {link.context}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Backlinks */}
                  {selected.backlinks && selected.backlinks.length > 0 && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                      <h4 className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                        <CornerUpLeft className="h-3 w-3 text-[var(--accent)]" />
                        反向链接
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {selected.backlinks.map((link, i) => (
                          <button
                            key={i}
                            onClick={() => navigateToNote(link.target)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                              link.weight === 'strong'
                                ? 'border-[var(--accent)]/30 bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent)]/20'
                                : link.weight === 'context'
                                  ? 'border-[var(--border)] bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:border-[var(--accent)]/30 hover:text-[var(--accent)]'
                                  : 'border-[var(--border)] bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:border-[var(--accent)]/30 hover:text-[var(--accent)]'
                            }`}
                          >
                            <CornerUpLeft className="h-3 w-3 shrink-0" />
                            <span className="break-words">{link.target}</span>
                            {link.context && (
                              <span className="text-[10px] opacity-60 break-words">— {link.context}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* QAs */}
                  {selected.qas.length > 0 && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                      <h4 className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                        <HelpCircle className="h-3 w-3 text-[var(--accent)]" />
                        常见问题
                      </h4>
                      <div className="space-y-4">
                        {selected.qas.map((qa, i) => (
                          <div key={i} className="space-y-1.5">
                            <p className="text-sm font-medium text-[var(--text-primary)] break-words">Q: {qa.question}</p>
                            <p className="text-sm leading-relaxed text-[var(--text-secondary)] break-words">{qa.answer}</p>
                            {qa.source && (
                              <p className="text-[10px] text-[var(--text-tertiary)] break-words">来源: {qa.source}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Content */}
                  {selected.content && (
                    <div>
                      <h4 className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                        <BookOpen className="h-3 w-3 text-[var(--accent)]" />
                        详细内容
                      </h4>
                      <div className="markdown-content rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ node, ...props }) => (
                              <a {...props} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--accent)] underline transition-opacity hover:opacity-80" />
                            ),
                            p: ({ node, ...props }) => <p {...props} className="mb-3 text-sm leading-relaxed text-[var(--text-secondary)]" />,
                            h1: ({ node, ...props }) => <h1 {...props} className="mb-3 mt-5 text-xl font-semibold text-[var(--text-primary)]" />,
                            h2: ({ node, ...props }) => <h2 {...props} className="mb-2 mt-4 text-lg font-semibold text-[var(--text-primary)]" />,
                            h3: ({ node, ...props }) => <h3 {...props} className="mb-2 mt-3 text-base font-semibold text-[var(--text-primary)]" />,
                            ul: ({ node, ...props }) => <ul {...props} className="mb-3 ml-4 list-disc text-sm text-[var(--text-secondary)]" />,
                            ol: ({ node, ...props }) => <ol {...props} className="mb-3 ml-4 list-decimal text-sm text-[var(--text-secondary)]" />,
                            li: ({ node, ...props }) => <li {...props} className="mb-1" />,
                            code: ({ node, ...props }) => <code {...props} className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-primary)]" />,
                            pre: ({ node, ...props }) => <pre {...props} className="my-3 overflow-x-auto rounded-lg bg-[var(--bg-hover)] p-3 font-mono text-sm break-words" />,
                            blockquote: ({ node, ...props }) => <blockquote {...props} className="my-3 border-l-2 border-[var(--accent)] pl-3 italic text-[var(--text-secondary)]" />,
                            strong: ({ node, ...props }) => <strong {...props} className="font-semibold text-[var(--text-primary)]" />,
                            hr: ({ node, ...props }) => <hr {...props} className="my-4 border-[var(--border)]" />,
                            table: ({ node, ...props }) => <table {...props} className="mb-3 w-full text-sm text-[var(--text-secondary)]" />,
                            th: ({ node, ...props }) => <th {...props} className="border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-2 text-left text-xs font-semibold text-[var(--text-primary)]" />,
                            td: ({ node, ...props }) => <td {...props} className="border border-[var(--border)] px-3 py-2" />,
                          }}
                        >
                          {selected.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-[var(--text-tertiary)]">
              <BookOpen className="h-10 w-10 opacity-40" />
              <p className="mt-3 text-sm">选择左侧笔记查看详情</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
