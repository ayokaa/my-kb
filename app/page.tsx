'use client';

import { useState, useEffect } from 'react';
import Sidebar, { type Tab } from '@/components/Sidebar';
import ChatPanel from '@/components/ChatPanel';
import InboxPanel from '@/components/InboxPanel';
import RSSPanel from '@/components/RSSPanel';
import NotesPanel from '@/components/NotesPanel';
import TasksPanel from '@/components/TasksPanel';

export default function HomePage() {
  const [tab, setTab] = useState<Tab>('chat');
  const [inboxCount, setInboxCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);

  function refreshInboxCount() {
    fetch('/api/inbox', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setInboxCount(d.entries?.length || 0))
      .catch(() => {});
  }

  useEffect(() => {
    refreshInboxCount();
  }, [tab]);

  useEffect(() => {
    const poll = () => {
      fetch('/api/tasks?filter=pending', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => setTaskCount(d.tasks?.length || 0))
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen bg-[var(--bg-primary)]">
      <Sidebar active={tab} onChange={setTab} inboxCount={inboxCount} taskCount={taskCount} />
      <main className="flex-1 overflow-hidden p-5">
        {tab === 'chat' && <ChatPanel />}
        {tab === 'inbox' && <InboxPanel count={inboxCount} onChange={refreshInboxCount} taskCount={taskCount} />}
        {tab === 'tasks' && <TasksPanel />}
        {tab === 'rss' && <RSSPanel />}
        {tab === 'notes' && <NotesPanel />}
      </main>
    </div>
  );
}
