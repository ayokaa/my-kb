'use client';

import { useChat } from 'ai/react';

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold text-gray-800">Agent 知识库</h1>

        <div className="mb-4 min-h-[60vh] space-y-4 rounded-lg bg-white p-4 shadow">
          {messages.length === 0 && (
            <p className="text-center text-gray-400">开始提问...</p>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                <div className="mb-1 text-xs opacity-70">
                  {m.role === 'user' ? '你' : 'Agent'}
                </div>
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          ))}

          {isLoading && messages.at(-1)?.role === 'user' && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-500">
                思考中...
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="问点什么..."
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white disabled:bg-gray-400"
          >
            发送
          </button>
        </form>
      </div>
    </main>
  );
}
