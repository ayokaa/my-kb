'use client';

import { useState, useEffect } from 'react';
import Sidebar, { type Tab } from '@/components/Sidebar';
import ChatPanel from '@/components/ChatPanel';
import InboxPanel from '@/components/InboxPanel';
import RSSPanel from '@/components/RSSPanel';
import { BookOpen } from 'lucide-react';

export default function HomePage() {
  const [tab, setTab] = useState<Tab>('chat');
  const [inboxCount, setInboxCount] = useState(0);

  useEffect(() => {
    fetch('/api/inbox')
      .then((r) => r.json())
      .then((d) => setInboxCount(d.entries?.length || 0))
      .catch(() => {});
  }, [tab]);

  return (
    <div className="flex h-screen bg-[var(--bg-primary)]">
      <Sidebar active={tab} onChange={setTab} inboxCount={inboxCount} />
      <main className="flex-1 overflow-hidden p-5">
        {tab === 'chat' && <ChatPanel />}
        {tab === 'inbox' && <InboxPanel />}
        {tab === 'rss' && <RSSPanel />}
        {tab === 'notes' && (
          <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-dim)]">
              <BookOpen className="h-8 w-8 text-[var(--accent)]" />
            </div>
            <p className="mt-4 font-[family-name:var(--font-serif)] text-xl font-semibold tracking-wide text-[var(--text-primary)]">
              笔记列表
            </p>
            <p className="mt-1 text-sm text-[var(--text-tertiary)]">即将上线</p>
          </div>
        )}
      </main>
    </div>
  );
}
