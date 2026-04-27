'use client';

import { useState, useEffect } from 'react';
import { Settings, Save, Loader2, CheckCircle2 } from 'lucide-react';

interface SettingsData {
  llm: {
    model: string;
    apiKey: string;
    baseUrl: string;
  };
  cron: {
    rssIntervalMinutes: number;
    relinkCronExpression: string;
  };
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[SettingsPanel] Failed to load settings:', err);
        setError('加载配置失败');
        setLoading(false);
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setError('');

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '保存失败');
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      setError('保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <Settings className="h-6 w-6 text-[var(--accent)]" />
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">系统设置</h2>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--error)] bg-red-500/10 px-4 py-3 text-sm text-[var(--error)]">
          {error}
        </div>
      )}

      {saved && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          配置已保存
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            LLM 配置
          </h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">模型名称</label>
              <input
                type="text"
                value={settings?.llm.model || ''}
                onChange={(e) => setSettings((s) => s ? { ...s, llm: { ...s.llm, model: e.target.value } } : s)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                placeholder="MiniMax-M2.7"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">API 密钥</label>
              <input
                type="password"
                value={settings?.llm.apiKey || ''}
                onChange={(e) => setSettings((s) => s ? { ...s, llm: { ...s.llm, apiKey: e.target.value } } : s)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                placeholder="sk-..."
              />
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">留空则使用环境变量 MINIMAX_API_KEY</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">Base URL</label>
              <input
                type="text"
                value={settings?.llm.baseUrl || ''}
                onChange={(e) => setSettings((s) => s ? { ...s, llm: { ...s.llm, baseUrl: e.target.value } } : s)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                placeholder="https://api.minimaxi.com/v1"
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            定时任务
          </h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">
                RSS 检查间隔（分钟）
              </label>
              <input
                type="number"
                min={1}
                value={settings?.cron.rssIntervalMinutes || 60}
                onChange={(e) => setSettings((s) => s ? { ...s, cron: { ...s.cron, rssIntervalMinutes: parseInt(e.target.value, 10) || 1 } } : s)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">
                Relink 定时表达式（Cron）
              </label>
              <input
                type="text"
                value={settings?.cron.relinkCronExpression || ''}
                onChange={(e) => setSettings((s) => s ? { ...s, cron: { ...s.cron, relinkCronExpression: e.target.value } } : s)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                placeholder="0 3 * * *"
              />
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">默认每天凌晨 3 点运行</p>
            </div>
          </div>
        </section>

        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[var(--bg-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存设置
        </button>
      </form>
    </div>
  );
}
