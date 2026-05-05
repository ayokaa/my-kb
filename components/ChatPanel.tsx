'use client';

import { Plus, MessageSquare, Trash2 } from 'lucide-react';
import { useConversationManager } from '@/hooks/useConversationManager';
import ChatSession from './ChatSession';

export default function ChatPanel() {
  const {
    ready,
    conversations,
    activeId,
    convMessages,
    confirmingDeleteId,
    streamingIds,
    handleNewConversation,
    handleSelectConversation,
    handleDeleteConversation,
    handleSave,
    handleStreamStateChange,
    setCurrentSources,
  } = useConversationManager();

  return (
    <div className="flex h-full gap-4 overflow-hidden" data-ready={ready}>
      <div className="flex h-full w-52 flex-col gap-3">
        <button
          onClick={handleNewConversation}
          className="btn-primary flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium"
        >
          <Plus className="h-4 w-4" />
          新对话
        </button>

        <div className="flex-1 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-2">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-[var(--text-tertiary)]">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-dim)]">
                <MessageSquare className="h-5 w-5 text-[var(--accent)] opacity-60" />
              </div>
              <p className="mt-2 text-xs">还没有对话</p>
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`group flex items-center gap-1 rounded-lg transition-all ${
                    activeId === conv.id
                      ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <button
                    onClick={() => handleSelectConversation(conv.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-xs"
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="flex-1 truncate font-medium">{conv.title}</span>
                    {conv.turnCount > 0 && (
                      <span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
                        {conv.turnCount}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConversation(conv.id);
                    }}
                    aria-label={confirmingDeleteId === conv.id ? '确认删除' : '删除对话'}
                    title={confirmingDeleteId === conv.id ? '确认删除' : '删除对话'}
                    className={`mr-1.5 shrink-0 flex items-center gap-1 rounded px-1.5 py-1 text-[10px] transition-all ${
                      confirmingDeleteId === conv.id
                        ? 'bg-red-900/30 text-[var(--error)] opacity-100'
                        : 'p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-900/20 hover:text-[var(--error)]'
                    }`}
                  >
                    <Trash2 className="h-3 w-3 shrink-0" />
                    {confirmingDeleteId === conv.id && <span className="shrink-0">确认</span>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex h-full flex-1 flex-col overflow-hidden">
        {conversations.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--text-tertiary)]">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-dim)]">
              <MessageSquare className="h-7 w-7 text-[var(--accent)] opacity-60" />
            </div>
            <p className="text-sm">点击「新对话」开始聊天</p>
          </div>
        ) : (
          conversations.map((conv) => {
            const keepAlive = streamingIds.has(conv.id);
            const isActive = activeId === conv.id;
            if (!isActive && !keepAlive) return null;
            return (
              <ChatSession
                key={conv.id}
                conversationId={conv.id}
                initialMessages={convMessages[conv.id] || []}
                isActive={isActive}
                onSources={setCurrentSources}
                onSave={handleSave}
                onNewConversation={handleNewConversation}
                onStreamStateChange={handleStreamStateChange}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
