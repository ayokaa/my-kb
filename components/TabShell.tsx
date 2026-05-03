'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSSE } from '@/hooks/useSSE';
import Sidebar, { type Tab } from './Sidebar';
import ChatPanel from './ChatPanel';
import InboxPanel from './InboxPanel';
import IngestPanel from './IngestPanel';
import RSSPanel from './RSSPanel';
import TasksPanel from './TasksPanel';
import SettingsPanel from './SettingsPanel';
import LogsPanel from './LogsPanel';
import MemoryPanel from './MemoryPanel';
import type { InboxEvent } from '@/lib/events';

interface TabShellProps {
  notesPanel?: React.ReactNode;
}

export default function TabShell({ notesPanel }: TabShellProps) {
  const [tab, setTab] = useState<Tab>('chat');
  const [inboxCount, setInboxCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);

  // SSE: 事件驱动更新侧边栏计数
  const { connected } = useSSE({
    onInbox: useCallback((e: InboxEvent) => {
      if (e.action === 'new') {
        // 有新条目时刷新计数
        fetch('/api/inbox', { cache: 'no-store' })
          .then((r) => r.json())
          .then((d) => setInboxCount(d.entries?.length || 0))
          .catch(() => {});
      }
    }, []),
    onTask: useCallback(() => {
      fetch('/api/tasks?filter=inbox_pending', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => setTaskCount(d.tasks?.length || 0))
        .catch(() => {});
    }, []),
    onNote: useCallback(() => {
      // 笔记变更时刷新计数（可能影响收件箱/任务状态）
      fetch('/api/inbox', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => setInboxCount(d.entries?.length || 0))
        .catch(() => {});
    }, []),
  });

  function refreshInboxCount() {
    fetch('/api/inbox', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setInboxCount(d.entries?.length || 0))
      .catch(() => {});
  }

  useEffect(() => {
    // tab 切换时刷新收件箱计数
    refreshInboxCount();
  }, [tab]);

  return (
    <>
      <Sidebar active={tab} onChange={setTab} inboxCount={inboxCount} taskCount={taskCount} connected={connected} />
      <main className="flex-1 overflow-hidden p-5">
        <div data-testid="panel-chat" className={tab === 'chat' ? 'h-full' : 'hidden'}>
          <ChatPanel />
        </div>
        <div data-testid="panel-inbox" className={tab === 'inbox' ? 'h-full' : 'hidden'}>
          <InboxPanel count={inboxCount} onChange={refreshInboxCount} taskCount={taskCount} isActive={tab === 'inbox'} />
        </div>
        <div data-testid="panel-ingest" className={tab === 'ingest' ? 'h-full overflow-y-auto' : 'hidden'}>
          <IngestPanel />
        </div>
        <div data-testid="panel-notes" className={tab === 'notes' ? 'h-full' : 'hidden'}>
          {notesPanel || <div />}
        </div>
        <div data-testid="panel-rss" className={tab === 'rss' ? 'h-full' : 'hidden'}>
          <RSSPanel isActive={tab === 'rss'} />
        </div>
        <div data-testid="panel-tasks" className={tab === 'tasks' ? 'h-full' : 'hidden'}>
          <TasksPanel isActive={tab === 'tasks'} />
        </div>
        <div data-testid="panel-settings" className={tab === 'settings' ? 'h-full overflow-y-auto' : 'hidden'}>
          <SettingsPanel />
        </div>
        <div data-testid="panel-logs" className={tab === 'logs' ? 'h-full' : 'hidden'}>
          <LogsPanel isActive={tab === 'logs'} />
        </div>
        <div data-testid="panel-memory" className={tab === 'memory' ? 'h-full' : 'hidden'}>
          <MemoryPanel isActive={tab === 'memory'} />
        </div>
      </main>
    </>
  );
}
