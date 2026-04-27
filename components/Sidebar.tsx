'use client';

import { MessageSquare, Inbox, BookOpen, Sparkles, Rss, ListChecks } from 'lucide-react';

export type Tab = 'chat' | 'inbox' | 'tasks' | 'notes' | 'rss';

interface SidebarProps {
  active: Tab;
  onChange: (tab: Tab) => void;
  inboxCount?: number;
  taskCount?: number;
}

const items: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'chat', label: '对话', icon: MessageSquare },
  { id: 'inbox', label: '收件箱', icon: Inbox },
  { id: 'tasks', label: '任务', icon: ListChecks },
  { id: 'rss', label: '订阅', icon: Rss },
  { id: 'notes', label: '笔记', icon: BookOpen },
];

export default function Sidebar({ active, onChange, inboxCount = 0, taskCount = 0 }: SidebarProps) {
  return (
    <aside className="glass flex h-screen w-64 flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)]">
          <Sparkles className="h-5 w-5 text-[var(--bg-primary)]" />
        </div>
        <div>
          <h1 className="font-[family-name:var(--font-serif)] text-lg font-semibold leading-tight tracking-wide text-[var(--text-primary)]">
            知识库
          </h1>
          <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
            Knowledge Base
          </p>
        </div>
      </div>

      <div className="divider-gradient mx-4" />

      {/* Nav */}
      <nav className="flex-1 p-3">
        {items.map((item) => {
          const isActive = active === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm transition-all duration-200 ${
                isActive
                  ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className={`h-4 w-4 transition-colors ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]'}`} />
              <span className="flex-1 text-left font-medium">{item.label}</span>
              {item.id === 'inbox' && inboxCount > 0 && (
                <span className="rounded-md bg-[var(--error)] px-2 py-0.5 text-[10px] font-bold text-white">
                  {inboxCount}
                </span>
              )}
              {item.id === 'tasks' && taskCount > 0 && (
                <span className="rounded-md bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold text-orange-400">
                  {taskCount}
                </span>
              )}
              {isActive && (
                <div className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Status</p>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[var(--success)] shadow-[0_0_4px_var(--success)]" />
            <span className="text-xs text-[var(--text-secondary)]">系统正常</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
