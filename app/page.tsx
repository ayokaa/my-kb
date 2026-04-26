'use client';

import { useState, useEffect } from 'react';
import Sidebar, { type Tab } from '@/components/Sidebar';
import ChatPanel from '@/components/ChatPanel';
import InboxPanel from '@/components/InboxPanel';
import RSSPanel from '@/components/RSSPanel';
import NotesPanel from '@/components/NotesPanel';

export default function HomePage() {
  const [tab, setTab] = useState<Tab>('chat');
  const [inboxCount, setInboxCount] = useState(0);

  function refreshInboxCount() {
    fetch('/api/inbox', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setInboxCount(d.entries?.length || 0))
      .catch(() => {});
  }

  useEffect(() => {
    refreshInboxCount();
  }, [tab]);

  return (
    <div className="flex h-screen bg-[var(--bg-primary)]">
      <Sidebar active={tab} onChange={setTab} inboxCount={inboxCount} />
      <main className="flex-1 overflow-hidden p-5">
        {tab === 'chat' && <ChatPanel />}
        {tab === 'inbox' && <InboxPanel count={inboxCount} onChange={refreshInboxCount} />}
        {tab === 'rss' && <RSSPanel />}
        {tab === 'notes' && <NotesPanel />}
      </main>
    </div>
  );
}
