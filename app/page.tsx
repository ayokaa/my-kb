'use client';

import { useState } from 'react';
import Sidebar, { type Tab } from '@/components/Sidebar';
import ChatPanel from '@/components/ChatPanel';
import InboxPanel from '@/components/InboxPanel';

export default function HomePage() {
  const [tab, setTab] = useState<Tab>('chat');

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar active={tab} onChange={setTab} />
      <main className="flex-1 overflow-hidden p-4">
        {tab === 'chat' && <ChatPanel />}
        {tab === 'inbox' && <InboxPanel />}
        {tab === 'notes' && (
          <div className="flex h-full items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400">
            <div className="text-center">
              <p className="text-lg font-medium">笔记列表</p>
              <p className="mt-1 text-sm">即将上线</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
