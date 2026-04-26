'use client';

import { useState, useEffect } from 'react';
import { ListChecks, Loader2, CheckCircle2, XCircle2, Clock, RefreshCw } from 'lucide-react';

interface Task {
  id: string;
  type: string;
  payload: any;
  status: 'pending' | 'running' | 'done' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: any;
}

const STATUS_CONFIG: Record<Task['status'], { label: string; icon: React.ElementType; color: string; bg: string }> = {
  pending: { label: '等待中', icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  running: { label: '执行中', icon: Loader2, color: 'text-[var(--accent)]', bg: 'bg-[var(--accent-dim)]' },
  done: { label: '已完成', icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  failed: { label: '失败', icon: XCircle2, color: 'text-[var(--error)]', bg: 'bg-red-500/10' },
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

export default function TasksPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'running' | 'done' | 'failed'>('all');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/tasks', { cache: 'no-store' });
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {
      setTasks([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  const filtered = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);

  const counts = {
    all: tasks.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    running: tasks.filter((t) => t.status === 'running').length,
    done: tasks.filter((t) => t.status === 'done').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3">
        <ListChecks className="h-4 w-4 text-[var(--accent)]" />
        <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold tracking-wide">任务队列</h2>
        <span className="rounded-md bg-[var(--accent-dim)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">{counts.all}</span>
        <div className="ml-auto flex gap-1.5">
          {(['all', 'pending', 'running', 'done', 'failed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                filter === f
                  ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                  : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {f === 'all' ? '全部' : STATUS_CONFIG[f].label}
              {counts[f] > 0 && <span className="ml-1">{counts[f]}</span>}
            </button>
          ))}
        </div>
        <button onClick={load} disabled={loading} className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent)]">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        {filtered.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <ListChecks className="h-8 w-8 text-[var(--text-tertiary)]" />
            <p className="mt-3 text-sm text-[var(--text-tertiary)]">
              {tasks.length === 0 ? '还没有任务' : '无匹配结果'}
            </p>
          </div>
        )}

        <div className="space-y-2">
          {filtered.map((task) => {
            const cfg = STATUS_CONFIG[task.status];
            const Icon = cfg.icon;
            return (
              <div
                key={task.id}
                className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 transition-colors hover:border-[var(--border-hover)]"
              >
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${cfg.bg}`}>
                  <Icon className={`h-3.5 w-3.5 ${cfg.color} ${task.status === 'running' ? 'animate-spin' : ''}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)]">{task.type}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cfg.bg} ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-secondary)] break-all">
                    {task.payload?.fileName || JSON.stringify(task.payload)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
                    <span>创建 {formatDate(task.createdAt)}</span>
                    {task.startedAt && <span>开始 {formatDate(task.startedAt)}</span>}
                    {task.completedAt && <span>完成 {formatDate(task.completedAt)}</span>}
                  </div>
                  {task.error && (
                    <p className="mt-2 break-words rounded bg-red-900/10 px-2 py-1 text-[10px] text-[var(--error)]">
                      {task.error}
                    </p>
                  )}
                  {task.result?.skipped && (
                    <p className="mt-2 break-words rounded bg-amber-900/10 px-2 py-1 text-[10px] text-amber-400">
                      已跳过 · {task.result.reason}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
