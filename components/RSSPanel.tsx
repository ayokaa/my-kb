'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, Upload, Rss, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface Subscription {
  url: string;
  name: string;
  addedAt: string;
  lastChecked?: string;
  lastEntryCount?: number;
}

interface CheckResult {
  url: string;
  name: string;
  newItems: number;
  error?: string;
}

export default function RSSPanel({ isActive }: { isActive?: boolean }) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [checkResults, setCheckResults] = useState<CheckResult[]>([]);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rss/subscriptions');
      const data = await res.json();
      setSubscriptions(data.subscriptions || []);
    } catch (err) {
      console.error('[RSSPanel] Failed to load subscriptions:', err);
      setSubscriptions([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isActive) {
      load();
    }
  }, [isActive, load]);

  async function addSubscription(e: React.FormEvent) {
    e.preventDefault();
    if (!newUrl.trim()) return;
    try {
      const res = await fetch('/api/rss/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl, name: newName || undefined }),
      });
      if (res.ok) {
        setNewUrl('');
        setNewName('');
        load();
      }
    } catch (err) {
      console.error('[RSSPanel] Failed to add subscription:', err);
    }
  }

  async function removeSubscription(url: string) {
    try {
      await fetch('/api/rss/subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      load();
    } catch (err) {
      console.error('[RSSPanel] Failed to remove subscription:', err);
    }
  }

  async function checkAll() {
    setChecking(true);
    setCheckResults([]);
    try {
      const res = await fetch('/api/rss/subscriptions/check', { method: 'POST', body: '{}' });
      const data = await res.json();
      setCheckResults(data.results || []);
      load();
    } catch (err) {
      console.error('[RSSPanel] Failed to check subscriptions:', err);
    }
    setChecking(false);
  }

  async function importOPMLFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const xml = await file.text();
    setImporting(true);
    try {
      const res = await fetch('/api/rss/subscriptions/import-opml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml }),
      });
      if (res.ok) {
        load();
      }
    } catch (err) {
      console.error('[RSSPanel] Failed to import OPML:', err);
    }
    setImporting(false);
  }

  const totalNew = checkResults.reduce((s, r) => s + r.newItems, 0);

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rss className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="font-[family-name:var(--font-serif)] text-xl font-semibold tracking-wide">RSS 订阅</h2>
          <span className="rounded-md bg-[var(--accent-dim)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
            {subscriptions.length}
          </span>
        </div>
        <div className="flex gap-2">
          <label className="btn-ghost flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs">
            <Upload className="h-3.5 w-3.5" />
            导入 OPML
            <input type="file" accept=".opml,.xml" onChange={importOPMLFile} className="hidden" />
          </label>
          <button
            onClick={checkAll}
            disabled={checking || subscriptions.length === 0}
            className="btn-primary flex items-center gap-1.5 px-3 py-2 text-xs disabled:opacity-40"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            检查更新
          </button>
        </div>
      </div>

      {/* Check results */}
      {checkResults.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            检查完成 · 共 {totalNew} 篇新文章
          </p>
          <div className="mt-2 space-y-1">
            {checkResults.map((r) => (
              <div key={r.url} className="flex items-center gap-2 text-xs">
                {r.error ? (
                  <AlertCircle className="h-3.5 w-3.5 text-[var(--error)]" />
                ) : r.newItems > 0 ? (
                  <CheckCircle className="h-3.5 w-3.5 text-[var(--success)]" />
                ) : (
                  <span className="h-3.5 w-3.5 rounded-full border border-[var(--text-tertiary)]" />
                )}
                <span className="text-[var(--text-secondary)]">{r.name}</span>
                {r.error ? (
                  <span className="text-[var(--error)]">{r.error}</span>
                ) : (
                  <span className="text-[var(--accent)]">+{r.newItems}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add subscription */}
      <form onSubmit={addSubscription} className="flex gap-2">
        <input
          placeholder="RSS URL"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          className="input-dark flex-1 px-3 py-2.5 text-sm"
        />
        <input
          placeholder="名称（可选）"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="input-dark w-40 px-3 py-2.5 text-sm"
        />
        <button type="submit" className="btn-primary px-4 py-2.5 text-xs">
          <Plus className="h-4 w-4" />
        </button>
      </form>

      {/* Subscription list */}
      <div className="flex-1 space-y-2 overflow-y-auto">
        {subscriptions.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
            <Rss className="h-8 w-8 opacity-40" />
            <p className="mt-3 text-sm">还没有订阅源</p>
            <p className="mt-1 text-xs">添加 RSS URL 或导入 OPML 文件</p>
          </div>
        )}

        {subscriptions.map((sub) => (
          <div
            key={sub.url}
            className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">{sub.name}</p>
              <p className="truncate text-xs text-[var(--text-tertiary)]">{sub.url}</p>
              {sub.lastChecked && (
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                  上次检查: {new Date(sub.lastChecked).toLocaleString('zh-CN')}
                  {sub.lastEntryCount !== undefined && ` · ${sub.lastEntryCount} 条`}
                </p>
              )}
            </div>
            <button
              onClick={() => removeSubscription(sub.url)}
              aria-label="删除订阅"
              className="ml-3 shrink-0 rounded-lg p-2 text-[var(--text-tertiary)] transition-colors hover:bg-red-900/20 hover:text-[var(--error)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
