'use client';

import { MessageSquare, Inbox, BookOpen, Sparkles, Rss, ListChecks, PlusCircle, Settings, Sun, Moon, FileText } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export type Tab = 'chat' | 'inbox' | 'tasks' | 'notes' | 'rss' | 'ingest' | 'settings' | 'logs';

interface SidebarProps {
  active: Tab;
  onChange: (tab: Tab) => void;
  inboxCount?: number;
  taskCount?: number;
}

const items: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'chat', label: '对话', icon: MessageSquare },
  { id: 'inbox', label: '收件箱', icon: Inbox },
  { id: 'ingest', label: '添加知识', icon: PlusCircle },
  { id: 'tasks', label: '任务', icon: ListChecks },
  { id: 'rss', label: '订阅', icon: Rss },
  { id: 'notes', label: '笔记', icon: BookOpen },
  { id: 'logs', label: '日志', icon: FileText },
  { id: 'settings', label: '设置', icon: Settings },
];

export default function Sidebar({ active, onChange, inboxCount = 0, taskCount = 0, connected }: SidebarProps & { connected?: boolean | null }) {
  const { theme, toggle } = useTheme();
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
              data-testid={`nav-${item.id}`}
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
                <span className="rounded-full bg-[var(--error)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white min-w-[18px] text-center">
                  {inboxCount}
                </span>
              )}
              {item.id === 'tasks' && taskCount > 0 && (
                <span className="rounded-full bg-[var(--accent-dim)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[var(--accent)] min-w-[18px] text-center">
                  {taskCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--border)] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {connected == null ? (
              <>
                <div className="h-2 w-2 rounded-full bg-[var(--text-tertiary)]" />
                <span className="text-xs text-[var(--text-tertiary)]">连接中</span>
              </>
            ) : connected ? (
              <>
                <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
                <span className="text-xs text-[var(--text-secondary)]">已连接</span>
              </>
            ) : (
              <>
                <div className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)] animate-pulse" />
                <span className="text-xs text-[var(--text-secondary)]">重连中</span>
              </>
            )}
          </div>
          <button
            onClick={toggle}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-tertiary)] transition-all duration-200 hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
            title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
