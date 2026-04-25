'use client';

import { useState } from 'react';
import { useChat } from 'ai/react';
import { Send, Loader2, ChevronDown, ChevronRight, FileText, Link, Rss, Upload } from 'lucide-react';

export default function ChatPanel() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();
  const [showIngest, setShowIngest] = useState(false);
  const [ingestTab, setIngestTab] = useState<'text' | 'link' | 'file' | 'rss'>('text');
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult, setIngestResult] = useState('');

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
      setIngestResult(data.ok ? `✅ 已入库: ${data.title || data.count || 'success'}` : `❌ 失败: ${data.error}`);
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

  const tabs = [
    { id: 'text' as const, label: '文本', icon: FileText },
    { id: 'link' as const, label: '链接', icon: Link },
    { id: 'file' as const, label: '文件', icon: Upload },
    { id: 'rss' as const, label: 'RSS', icon: Rss },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Ingest Panel */}
      <div className="mb-3 rounded-xl border border-gray-200 bg-white shadow-sm">
        <button
          onClick={() => setShowIngest(!showIngest)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {showIngest ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          添加知识
        </button>

        {showIngest && (
          <div className="border-t border-gray-100 p-4">
            <div className="mb-3 flex gap-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setIngestTab(tab.id)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      ingestTab === tab.id
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {ingestTab === 'text' && (
              <div className="space-y-2">
                <input
                  placeholder="标题（可选）"
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <textarea
                  placeholder="输入文本内容..."
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={() => { submitIngest('text', { type: 'text', title: textTitle, content: textInput }); setTextInput(''); setTextTitle(''); }}
                  disabled={ingestLoading || !textInput.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {ingestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '入库'}
                </button>
              </div>
            )}

            {ingestTab === 'link' && (
              <div className="flex gap-2">
                <input
                  placeholder="https://..."
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={() => { submitIngest('link', { type: 'link', url: linkUrl }); setLinkUrl(''); }}
                  disabled={ingestLoading || !linkUrl.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {ingestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '抓取'}
                </button>
              </div>
            )}

            {ingestTab === 'file' && (
              <div className="space-y-2">
                <input type="file" onChange={handleFileUpload} className="w-full text-sm" />
                <p className="text-xs text-gray-400">支持 PDF、Markdown、TXT</p>
              </div>
            )}

            {ingestTab === 'rss' && (
              <div className="space-y-2">
                <input
                  placeholder="RSS 名称（可选）"
                  value={rssName}
                  onChange={(e) => setRssName(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <div className="flex gap-2">
                  <input
                    placeholder="https://example.com/feed.xml"
                    value={rssUrl}
                    onChange={(e) => setRssUrl(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    onClick={() => { submitIngest('rss', { url: rssUrl, name: rssName }); setRssUrl(''); setRssName(''); }}
                    disabled={ingestLoading || !rssUrl.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
                  >
                    {ingestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '抓取'}
                  </button>
                </div>
              </div>
            )}

            {ingestResult && (
              <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">{ingestResult}</p>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="mb-3 flex-1 space-y-4 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-gray-400">
            <p className="text-lg">你好，我是你的知识库助手</p>
            <p className="mt-1 text-sm">可以问我关于你知识库里的任何问题</p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              <div className="mb-0.5 text-xs opacity-70">{m.role === 'user' ? '你' : 'Agent'}</div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
            </div>
          </div>
        ))}

        {isLoading && messages.at(-1)?.role === 'user' && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-2.5 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              思考中...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="问点什么..."
          className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="flex items-center gap-1 rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          <Send className="h-4 w-4" />
          发送
        </button>
      </form>
    </div>
  );
}
