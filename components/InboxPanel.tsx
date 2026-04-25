'use client';

import { useState, useEffect } from 'react';
import { Check, X, Loader2, ExternalLink, Calendar, Tag } from 'lucide-react';

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
          setResult(`✅ 已加入知识库: ${data.note.title}`);
        } else {
          setResult(`❌ 失败: ${data.error}`);
        }
      } else {
        // Reject: just archive for now
        setResult(`🗑️ 已忽略: ${entry.title}`);
      }
      // Remove from list
      setEntries((prev) => prev.filter((e) => e.filePath !== entry.filePath));
      setSelected(null);
    } catch (err: any) {
      setResult(`❌ 错误: ${err.message}`);
    }
    setProcessing(false);
  }

  const sourceLabel = (entry: InboxEntry) => {
    if (entry.rawMetadata.rss_source) return `RSS · ${entry.rawMetadata.rss_source}`;
    if (entry.rawMetadata.source_url) return `Web · ${entry.rawMetadata.source_url}`;
    if (entry.rawMetadata.original_filename) return `File · ${entry.rawMetadata.original_filename}`;
    return entry.sourceType;
  };

  return (
    <div className="flex h-full gap-4">
      {/* List */}
      <div className="flex w-80 flex-col gap-2 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">待审核 ({entries.length})</h2>
          <button onClick={load} className="text-xs text-blue-600 hover:underline" disabled={loading}>
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>

        {entries.length === 0 && !loading && (
          <p className="py-8 text-center text-sm text-gray-400">收件箱为空</p>
        )}

        {entries.map((entry) => (
          <button
            key={entry.filePath}
            onClick={() => setSelected(entry)}
            className={`rounded-lg border p-3 text-left transition-colors ${
              selected?.filePath === entry.filePath
                ? 'border-blue-300 bg-blue-50'
                : 'border-gray-100 bg-white hover:bg-gray-50'
            }`}
          >
            <p className="line-clamp-2 text-sm font-medium text-gray-800">{entry.title}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-gray-400">
              <Tag className="h-3 w-3" />
              {sourceLabel(entry)}
            </p>
          </button>
        ))}
      </div>

      {/* Detail */}
      <div className="flex flex-1 flex-col rounded-lg border border-gray-200 bg-white">
        {selected ? (
          <>
            <div className="border-b border-gray-100 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">{selected.title}</h3>
                  <p className="mt-1 flex items-center gap-2 text-sm text-gray-500">
                    <Calendar className="h-3.5 w-3.5" />
                    {selected.extractedAt
                      ? new Date(selected.extractedAt).toLocaleString('zh-CN')
                      : '未知时间'}
                    <span className="mx-1">·</span>
                    <Tag className="h-3.5 w-3.5" />
                    {sourceLabel(selected)}
                    {!!selected.rawMetadata.source_url && (
                      <a
                        href={String(selected.rawMetadata.source_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        原文
                      </a>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => processEntry(selected, 'reject')}
                    disabled={processing}
                    className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                    忽略
                  </button>
                  <button
                    onClick={() => processEntry(selected, 'approve')}
                    disabled={processing}
                    className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    加入知识库
                  </button>
                </div>
              </div>
              {result && (
                <p className="mt-2 rounded bg-gray-50 px-3 py-1.5 text-sm text-gray-700">{result}</p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="prose prose-sm max-w-none text-gray-700">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{selected.content}</pre>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-gray-400">
            <p>选择左侧条目查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}
