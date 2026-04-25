'use client';

import { useState } from 'react';
import { useChat } from 'ai/react';
import { Send, Loader2, ChevronDown, ChevronRight, FileText, Link, Rss, Upload, Bot, User } from 'lucide-react';

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
      setIngestResult(data.ok ? `已入库 · ${data.title || data.count || 'success'}` : `失败 · ${data.error}`);
    } catch (err: any) {
      setIngestResult(`错误 · ${err.message}`);
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
      <div className="mb-4 card-elevated overflow-hidden">
        <button
          onClick={() => setShowIngest(!showIngest)}
          className="flex w-full items-center gap-2 px-5 py-3.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          {showIngest ? <ChevronDown className="h-4 w-4 text-[var(--accent)]" /> : <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />}
          <span className="font-[family-name:var(--font-serif)] text-base tracking-wide">添加知识</span>
          <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Ingest</span>
        </button>

        {showIngest && (
          <div className="border-t border-[var(--border)] px-5 pb-5 pt-3">
            <div className="mb-4 flex gap-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setIngestTab(tab.id)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-all ${
                      ingestTab === tab.id
                        ? 'bg-[var(--accent)] text-[var(--bg-primary)]'
                        : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {ingestTab === 'text' && (
              <div className="space-y-3">
                <input
                  placeholder="标题（可选）"
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                  className="input-dark w-full px-3 py-2.5 text-sm"
                />
                <textarea
                  placeholder="输入文本内容..."
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={3}
                  className="input-dark w-full px-3 py-2.5 text-sm resize-none"
                />
                <button
                  onClick={() => { submitIngest('text', { type: 'text', title: textTitle, content: textInput }); setTextInput(''); setTextTitle(''); }}
                  disabled={ingestLoading || !textInput.trim()}
                  className="btn-primary px-4 py-2 text-xs disabled:opacity-40"
                >
                  {ingestLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '入库'}
                </button>
              </div>
            )}

            {ingestTab === 'link' && (
              <div className="flex gap-2">
                <input
                  placeholder="https://..."
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  className="input-dark flex-1 px-3 py-2.5 text-sm"
                />
                <button
                  onClick={() => { submitIngest('link', { type: 'link', url: linkUrl }); setLinkUrl(''); }}
                  disabled={ingestLoading || !linkUrl.trim()}
                  className="btn-primary px-4 py-2 text-xs disabled:opacity-40"
                >
                  {ingestLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '抓取'}
                </button>
              </div>
            )}

            {ingestTab === 'file' && (
              <div className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-[var(--border-hover)] px-4 py-6 text-sm text-[var(--text-tertiary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-secondary)]">
                  <Upload className="h-4 w-4" />
                  <span>点击或拖拽上传文件</span>
                  <input type="file" onChange={handleFileUpload} className="hidden" />
                </label>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">支持 PDF、Markdown、TXT</p>
              </div>
            )}

            {ingestTab === 'rss' && (
              <div className="space-y-3">
                <input
                  placeholder="RSS 名称（可选）"
                  value={rssName}
                  onChange={(e) => setRssName(e.target.value)}
                  className="input-dark w-full px-3 py-2.5 text-sm"
                />
                <div className="flex gap-2">
                  <input
                    placeholder="https://example.com/feed.xml"
                    value={rssUrl}
                    onChange={(e) => setRssUrl(e.target.value)}
                    className="input-dark flex-1 px-3 py-2.5 text-sm"
                  />
                  <button
                    onClick={() => { submitIngest('rss', { url: rssUrl, name: rssName }); setRssUrl(''); setRssName(''); }}
                    disabled={ingestLoading || !rssUrl.trim()}
                    className="btn-primary px-4 py-2 text-xs disabled:opacity-40"
                  >
                    {ingestLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '抓取'}
                  </button>
                </div>
              </div>
            )}

            {ingestResult && (
              <p className={`mt-3 rounded-md px-3 py-2 text-xs ${ingestResult.startsWith('已') ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'bg-red-900/20 text-[var(--error)]'}`}>
                {ingestResult}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="mb-4 flex flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-dim)]">
              <Bot className="h-8 w-8 text-[var(--accent)]" />
            </div>
            <p className="font-[family-name:var(--font-serif)] text-xl font-semibold tracking-wide text-[var(--text-primary)]">
              知识库助手
            </p>
            <p className="mt-1 text-sm text-[var(--text-tertiary)]">基于已有知识回答你的问题</p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex max-w-[82%] gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                m.role === 'user' ? 'bg-[var(--accent)]' : 'bg-[var(--bg-elevated)] border border-[var(--border)]'
              }`}>
                {m.role === 'user' ? <User className="h-3.5 w-3.5 text-[var(--bg-primary)]" /> : <Bot className="h-3.5 w-3.5 text-[var(--accent)]" />}
              </div>
              <div
                className={`px-4 py-3 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'rounded-2xl rounded-br-md bg-[var(--accent)] text-[var(--bg-primary)]'
                    : 'rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                }`}
              >
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          </div>
        ))}

        {isLoading && messages.at(-1)?.role === 'user' && (
          <div className="flex justify-start">
            <div className="flex gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
                <Bot className="h-3.5 w-3.5 text-[var(--accent)]" />
              </div>
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-tertiary)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                思考中...
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="问点什么..."
          className="input-dark flex-1 px-4 py-3.5 text-sm"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="btn-primary flex items-center gap-2 px-5 py-3.5 text-sm disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
