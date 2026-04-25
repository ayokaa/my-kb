'use client';

import { MessageSquare, Inbox, BookOpen, PlusCircle } from 'lucide-react';

export type Tab = 'chat' | 'inbox' | 'notes';

interface SidebarProps {
  active: Tab;
  onChange: (tab: Tab) => void;
  inboxCount?: number;
}

const items: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'chat', label: '聊天', icon: MessageSquare },
  { id: 'inbox', label: '收件箱', icon: Inbox },
  { id: 'notes', label: '笔记', icon: BookOpen },
];

export default function Sidebar({ active, onChange, inboxCount = 0 }: SidebarProps) {
  return (
    <aside className="flex h-screen w-56 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <BookOpen className="h-5 w-5 text-blue-600" />
        <span className="font-semibold text-gray-800">知识库</span>
      </div>

      <nav className="flex-1 p-2">
        {items.map((item) => {
          const isActive = active === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.id === 'inbox' && inboxCount > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">
                  {inboxCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-gray-100 p-3">
        <button
          onClick={() => onChange('chat')}
          className="flex w-full items-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <PlusCircle className="h-4 w-4" />
          新知识
        </button>
      </div>
    </aside>
  );
}
