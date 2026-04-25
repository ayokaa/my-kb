'use client';

import { useState } from 'react';
import { useChat } from 'ai/react';

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();
  const [showIngest, setShowIngest] = useState(false);
  const [ingestTab, setIngestTab] = useState<'text' | 'link' | 'file' | 'rss'>('text');
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult, setIngestResult] = useState<string>('');

  // Ingest form states
  const [textInput, setTextInput] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [rssUrl, setRssUrl] = useState('');
  const [rssName, setRssName] = useState('');

  async function submitIngest(type: string, body: object) {
    setIngestLoading(true);
    setIngestResult('');
    try {
      const res = await fetch(type === 'file' ? '/api/upload' : type === 'rss' ? '/api/rss' : '/api/ingest', {
        method: 'POST',
        headers: type === 'file' ? undefined : { 'Content-Type': 'application/json' },
        body: type === 'file' ? (body as any) : JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setIngestResult(`✅ 已入库: ${data.title || data.count || 'success'}`);
      } else {
        setIngestResult(`❌ 失败: ${data.error}`);
      }
    } catch (err: any) {
      setIngestResult(`❌ 错误: ${err.message}`);
    }
    setIngestLoading(false);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    await submitIngest('file', formData);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-4 text-2xl font-bold text-gray-800">Agent 知识库</h1>

        {/* Ingest Panel */}
        <div className="mb-4 rounded-lg bg-white shadow">
          <button
            onClick={() => setShowIngest(!showIngest)}
            className="w-full px-4 py-2 text-left font-medium text-gray-700 hover:bg-gray-50"
          >
            {showIngest ? '▼' : '▶'} 添加知识
          </button>

          {showIngest && (
            <div className="border-t p-4">
              <div className="mb-3 flex gap-2">
                {(['text', 'link', 'file', 'rss'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setIngestTab(tab)}
                    className={`rounded px-3 py-1 text-sm ${
                      ingestTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    {tab === 'text' ? '文本' : tab === 'link' ? '链接' : tab === 'file' ? '文件' : 'RSS'}
                  </button>
                ))}
              </div>

              {ingestTab === 'text' && (
                <div className="space-y-2">
                  <input
                    placeholder="标题（可选）"
                    value={textTitle}
                    onChange={(e) => setTextTitle(e.target.value)}
                    className="w-full rounded border px-3 py-2"
                  />
                  <textarea
                    placeholder="输入文本内容..."
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    rows={4}
                    className="w-full rounded border px-3 py-2"
                  />
                  <button
                    onClick={() => submitIngest('text', { type: 'text', title: textTitle, content: textInput })}
                    disabled={ingestLoading || !textInput.trim()}
                    className="rounded bg-blue-600 px-4 py-2 text-white disabled:bg-gray-400"
                  >
                    入库
                  </button>
                </div>
              )}

              {ingestTab === 'link' && (
                <div className="space-y-2">
                  <input
                    placeholder="https://..."
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    className="w-full rounded border px-3 py-2"
                  />
                  <button
                    onClick={() => submitIngest('link', { type: 'link', url: linkUrl })}
                    disabled={ingestLoading || !linkUrl.trim()}
                    className="rounded bg-blue-600 px-4 py-2 text-white disabled:bg-gray-400"
                  >
                    抓取并入库
                  </button>
                </div>
              )}

              {ingestTab === 'file' && (
                <div className="space-y-2">
                  <input type="file" onChange={handleFileUpload} className="w-full" />
                  <p className="text-xs text-gray-500">支持 PDF、Markdown、TXT</p>
                </div>
              )}

              {ingestTab === 'rss' && (
                <div className="space-y-2">
                  <input
                    placeholder="RSS 名称（可选）"
                    value={rssName}
                    onChange={(e) => setRssName(e.target.value)}
                    className="w-full rounded border px-3 py-2"
                  />
                  <input
                    placeholder="https://example.com/feed.xml"
                    value={rssUrl}
                    onChange={(e) => setRssUrl(e.target.value)}
                    className="w-full rounded border px-3 py-2"
                  />
                  <button
                    onClick={() => submitIngest('rss', { url: rssUrl, name: rssName })}
                    disabled={ingestLoading || !rssUrl.trim()}
                    className="rounded bg-blue-600 px-4 py-2 text-white disabled:bg-gray-400"
                  >
                    抓取 RSS
                  </button>
                </div>
              )}

              {ingestResult && (
                <p className="mt-2 text-sm">{ingestResult}</p>
              )}
            </div>
          )}
        </div>

        {/* Chat */}
        <div className="mb-4 min-h-[50vh] space-y-4 rounded-lg bg-white p-4 shadow">
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
