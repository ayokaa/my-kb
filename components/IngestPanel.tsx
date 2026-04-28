'use client';

import { useState } from 'react';
import { FileText, Link, Upload, Loader2 } from 'lucide-react';

const tabs = [
  { id: 'text' as const, label: '文本', icon: FileText },
  { id: 'link' as const, label: '链接', icon: Link },
  { id: 'file' as const, label: '文件', icon: Upload },
];

export default function IngestPanel() {
  const [ingestTab, setIngestTab] = useState<'text' | 'link' | 'file'>('text');
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult, setIngestResult] = useState('');
  const [textInput, setTextInput] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  async function submitIngest(type: string, body: object) {
    setIngestLoading(true);
    setIngestResult('');
    try {
      const res = await fetch(
        type === 'file' ? '/api/upload' : '/api/ingest',
        {
          method: 'POST',
          headers: type === 'file' ? undefined : { 'Content-Type': 'application/json' },
          body: type === 'file' ? (body as any) : JSON.stringify(body),
        }
      );
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

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h2 className="font-[family-name:var(--font-serif)] text-2xl font-semibold tracking-wide text-[var(--text-primary)]">
          添加知识
        </h2>
        <p className="mt-1 text-sm text-[var(--text-tertiary)]">
          通过文本、链接或文件将内容导入知识库
        </p>
      </div>

      <div className="card-elevated overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-[var(--border)]">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                data-testid={`ingest-tab-${tab.id}`}
                onClick={() => {
                  setIngestTab(tab.id);
                  setIngestResult('');
                }}
                className={`flex flex-1 items-center justify-center gap-2 px-4 py-3.5 text-sm font-medium transition-all ${
                  ingestTab === tab.id
                    ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]'
                    : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="p-6">
          {ingestTab === 'text' && (
            <div className="space-y-4">
              <input
                placeholder="标题（可选）"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                className="input-dark w-full px-4 py-3 text-sm"
              />
              <textarea
                placeholder="输入文本内容..."
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                rows={8}
                className="input-dark w-full px-4 py-3 text-sm resize-none"
              />
              <button
                onClick={() => {
                  submitIngest('text', { type: 'text', title: textTitle, content: textInput });
                  setTextInput('');
                  setTextTitle('');
                }}
                disabled={ingestLoading || !textInput.trim()}
                className="btn-primary px-6 py-2.5 text-sm disabled:opacity-40"
              >
                {ingestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '入库'}
              </button>
            </div>
          )}

          {ingestTab === 'link' && (
            <div className="space-y-4">
              <input
                placeholder="https://..."
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                className="input-dark w-full px-4 py-3 text-sm"
              />
              <button
                onClick={() => {
                  submitIngest('link', { type: 'link', url: linkUrl });
                  setLinkUrl('');
                }}
                disabled={ingestLoading || !linkUrl.trim()}
                className="btn-primary px-6 py-2.5 text-sm disabled:opacity-40"
              >
                {ingestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '抓取'}
              </button>
            </div>
          )}

          {ingestTab === 'file' && (
            <div className="space-y-4">
              <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[var(--border-hover)] px-8 py-10 text-sm text-[var(--text-tertiary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-secondary)]">
                <Upload className="h-8 w-8" />
                <span>点击或拖拽上传文件</span>
                <input
                  type="file"
                  accept=".pdf,.md,.txt,.markdown,application/pdf,text/plain,text/markdown"
                  aria-label="上传文件"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                支持 PDF、Markdown、TXT
              </p>
            </div>
          )}

          {ingestResult && (
            <p
              className={`mt-4 rounded-lg px-4 py-3 text-sm ${
                ingestResult.startsWith('已')
                  ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                  : 'bg-red-900/20 text-[var(--error)]'
              }`}
            >
              {ingestResult}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
