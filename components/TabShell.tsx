'use client';

import { useState, useEffect } from 'react';
import Sidebar, { type Tab } from './Sidebar';
import ChatPanel from './ChatPanel';
import InboxPanel from './InboxPanel';
import RSSPanel from './RSSPanel';
import TasksPanel from './TasksPanel';

interface TabShellProps {
  notesPanel?: React.ReactNode;
}

export default function TabShell({ notesPanel }: TabShellProps) {
  const [tab, setTab] = useState<Tab>('chat');
  const [inboxCount, setInboxCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);

  function refreshInboxCount() {
    fetch('/api/inbox', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setInboxCount(d.entries?.length || 0))
      .catch((err) => console.error('[TabShell] Failed to refresh inbox count:', err));
  }

  useEffect(() => {
    refreshInboxCount();
  }, [tab]);

  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === 'hidden') return;
      fetch('/api/tasks?filter=inbox_pending', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => setTaskCount(d.tasks?.length || 0))
        .catch((err) => console.error('[TabShell] Failed to poll tasks:', err));
    };
    poll();
    const interval = setInterval(poll, 3000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <>
      <Sidebar active={tab} onChange={setTab} inboxCount={inboxCount} taskCount={taskCount} />
      <main className="flex-1 overflow-hidden p-5">
        <div data-testid="panel-chat" className={tab === 'chat' ? 'h-full' : 'hidden'}>
          <ChatPanel />
        </div>
        <div data-testid="panel-inbox" className={tab === 'inbox' ? 'h-full' : 'hidden'}>
          <InboxPanel count={inboxCount} onChange={refreshInboxCount} taskCount={taskCount} isActive={tab === 'inbox'} />
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
      </main>
    </>
  );
}
