'use client';

import { useState, useEffect } from 'react';
import { Check, X, Loader2, ExternalLink, Calendar, Tag, Inbox, RefreshCw, Rss } from 'lucide-react';

interface InboxEntry {
  title: string;
  content: string;
  sourceType: string;
  extractedAt?: string;
  rawMetadata: Record<string, unknown>;
  filePath?: string;
}

export default function InboxPanel() {
  const [entries, setEntries] = useState<InboxEntry[]>([]);
  const [selected, setSelected] = useState<InboxEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/inbox');
      const data = await res.json();
      setEntries(data.entries || []);
      if (data.entries?.length > 0 && !selected) {
        setSelected(data.entries[0]);
      }
    } catch {
      setEntries([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function processEntry(entry: InboxEntry, action: 'approve' | 'reject') {
    const fileName = entry.filePath?.split('/').pop();
    if (!fileName) return;

    setProcessing(true);
    setResult('');
    try {
      if (action === 'approve') {
        const res = await fetch('/api/inbox/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName }),
        });
        const data = await res.json();
        if (data.ok) {
          setResult(`已加入处理队列 · ${entry.title}`);
        } else {
          setResult(`失败 · ${data.error}`);
        }
      } else {
        const res = await fetch('/api/inbox/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName }),
        });
        const data = await res.json();
        if (data.ok) {
          setResult(`已忽略 · ${entry.title}`);
        } else {
          setResult(`归档失败 · ${data.error}`);
        }
      }
      setEntries((prev) => prev.filter((e) => e.filePath !== entry.filePath));
      setSelected(null);
    } catch (err: any) {
      setResult(`错误 · ${err.message}`);
    }
    setProcessing(false);
  }

  const sourceLabel = (entry: InboxEntry) => {
    if (entry.rawMetadata.rss_source) return `RSS · ${entry.rawMetadata.rss_source}`;
    if (entry.rawMetadata.source_url) return `Web · ${new URL(String(entry.rawMetadata.source_url)).hostname}`;
    if (entry.rawMetadata.original_filename) return `File · ${entry.rawMetadata.original_filename}`;
    return entry.sourceType;
  };

  const isRssEntry = (entry: InboxEntry) => Boolean(entry.rawMetadata?.rss_source || entry.rawMetadata?.rss_link);
  const originalUrl = (entry: InboxEntry) => String(entry.rawMetadata?.rss_link || entry.rawMetadata?.source_url || '');

  return (
    <div className="flex h-full gap-5">
      {/* List */}
      <div className="flex w-80 flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-[var(--accent)]" />
            <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold tracking-wide">待审核</h2>
            <span className="rounded-md bg-[var(--accent-dim)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
              {entries.length}
            </span>
          </div>
          <button onClick={load} disabled={loading} className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent)]">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          {entries.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <Inbox className="h-8 w-8 text-[var(--text-tertiary)]" />
              <p className="mt-3 text-sm text-[var(--text-tertiary)]">收件箱为空</p>
            </div>
          )}

          {entries.map((entry) => (
            <button
              key={entry.filePath}
              onClick={() => setSelected(entry)}
              className={`w-full rounded-xl border p-4 text-left transition-all duration-200 ${
                selected?.filePath === entry.filePath
                  ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                  : 'border-transparent bg-[var(--bg-elevated)] hover:border-[var(--border-hover)]'
              }`}
            >
              <p className="line-clamp-2 text-sm font-medium text-[var(--text-primary)]">{entry.title}</p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                {isRssEntry(entry) ? <Rss className="h-3 w-3 text-orange-400" /> : <Tag className="h-3 w-3" />}
                {sourceLabel(entry)}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="flex flex-1 flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
        {selected ? (
          <>
            <div className="border-b border-[var(--border)] px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-[family-name:var(--font-serif)] text-xl font-semibold leading-snug tracking-wide text-[var(--text-primary)]">
                    {selected.title}
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--text-tertiary)]">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {selected.extractedAt
                        ? new Date(selected.extractedAt).toLocaleString('zh-CN')
                        : '未知时间'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Tag className="h-3 w-3" />
                      {sourceLabel(selected)}
                    </span>
                    {!!originalUrl(selected) && (
                      <a
                        href={originalUrl(selected)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[var(--accent)] transition-opacity hover:opacity-80"
                      >
                        <ExternalLink className="h-3 w-3" />
                        原文
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => processEntry(selected, 'reject')}
                    disabled={processing}
                    className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" />
                    忽略
                  </button>
                  <button
                    onClick={() => processEntry(selected, 'approve')}
                    disabled={processing}
                    className="btn-primary flex items-center gap-1.5 px-4 py-2 text-xs disabled:opacity-40"
                  >
                    {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    加入知识库
                  </button>
                </div>
              </div>
              {result && (
                <p className={`mt-3 rounded-md px-3 py-2 text-xs ${result.startsWith('已加入') ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : result.startsWith('已忽略') ? 'bg-[var(--bg-hover)] text-[var(--text-secondary)]' : 'bg-red-900/20 text-[var(--error)]'}`}>
                  {result}
                </p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {isRssEntry(selected) ? (
                <div className="space-y-6">
                  {/* 原文链接 */}
                  <a
                    href={originalUrl(selected)}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-4 transition-all hover:border-[var(--accent)] hover:bg-[var(--accent-dim)]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-500/10">
                      <Rss className="h-5 w-5 text-orange-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)]">
                        打开原文阅读
                      </p>
                      <p className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">
                        {originalUrl(selected)}
                      </p>
                    </div>
                    <ExternalLink className="h-4 w-4 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--accent)]" />
                  </a>

                  {/* Feed 摘要 */}
                  {selected.content && (
                    <div>
                      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                        Feed 摘要
                      </h4>
                      <p className="text-sm leading-relaxed text-[var(--text-secondary)] line-clamp-6 break-words">
                        {selected.content}
                      </p>
                    </div>
                  )}

                  {/* 提示 */}
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3">
                    <p className="text-xs text-[var(--text-tertiary)]">
                      点击「加入知识库」后，系统将自动爬取原文并生成结构化笔记。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="prose prose-invert prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap break-words font-[family-name:var(--font-mono)] text-sm leading-[1.8] text-[var(--text-secondary)]">
                    {selected.content}
                  </pre>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-[var(--text-tertiary)]">
            <Inbox className="h-10 w-10 opacity-40" />
            <p className="mt-3 text-sm">选择左侧条目查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}
