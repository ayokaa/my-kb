'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Brain, Loader2, RefreshCw, User, BookOpen, MessageSquare, Heart,
  Pencil, Trash2, Plus, X, Check, Save, TriangleAlert,
} from 'lucide-react';
import { useToast } from '@/hooks/ToastContext';

interface UserProfile {
  role?: string;
  techStack: string[];
  interests: string[];
  background?: string;
  updatedAt?: string;
}

interface NoteKnowledge {
  level: 'aware' | 'referenced' | 'discussed';
  firstSeenAt: string;
  lastReferencedAt: string;
  notes: string;
}

interface ConversationDigestEntry {
  conversationId: string;
  summary: string;
  topics: string[];
  timestamp: string;
}

interface UserMemory {
  profile: UserProfile;
  noteKnowledge: Record<string, NoteKnowledge>;
  conversationDigest: ConversationDigestEntry[];
  preferences: Record<string, unknown>;
  updatedAt: string;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

function formatRelative(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    return d.toLocaleDateString('zh-CN');
  } catch {
    return iso;
  }
}

const LEVEL_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  aware: { label: '知晓', color: 'text-slate-400', bg: 'bg-slate-500/10' },
  referenced: { label: '引用过', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  discussed: { label: '深入讨论', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
};

const LEVEL_FALLBACK = { label: '未知', color: 'text-[var(--text-tertiary)]', bg: 'bg-[var(--bg-hover)]' };

interface MemoryPanelProps {
  isActive?: boolean;
}

export default function MemoryPanel({ isActive }: MemoryPanelProps) {
  const [memory, setMemory] = useState<UserMemory | null>(null);
  const [loading, setLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const { show } = useToast();

  // Profile edit state
  const [editingProfile, setEditingProfile] = useState(false);
  const [editRole, setEditRole] = useState('');
  const [editBackground, setEditBackground] = useState('');
  const [editTechStack, setEditTechStack] = useState<string[]>([]);
  const [editInterests, setEditInterests] = useState<string[]>([]);
  const [newTech, setNewTech] = useState('');
  const [newInterest, setNewInterest] = useState('');

  // Deleting states
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [deletingDigest, setDeletingDigest] = useState<{ conversationId: string; timestamp: string } | null>(null);
  const [deletingPrefKey, setDeletingPrefKey] = useState<string | null>(null);

  // Preference edit state
  const [editingPrefKey, setEditingPrefKey] = useState<string | null>(null);
  const [editPrefValue, setEditPrefValue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/memory', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMemory(data);
    } catch {
      show('加载记忆失败', 'error');
    }
    setLoading(false);
  }, [show]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isActive) {
      load();
    }
  }, [isActive, load]);

  // ── Profile edit ────────────────────────────────────────────

  function startEditProfile() {
    if (!memory) return;
    setEditRole(memory.profile.role || '');
    setEditBackground(memory.profile.background || '');
    setEditTechStack([...memory.profile.techStack]);
    setEditInterests([...memory.profile.interests]);
    setNewTech('');
    setNewInterest('');
    setEditingProfile(true);
  }

  function cancelEditProfile() {
    setEditingProfile(false);
  }

  async function saveProfile() {
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateProfile',
          profile: {
            role: editRole || undefined,
            background: editBackground || undefined,
            techStack: editTechStack,
            interests: editInterests,
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      show('档案已更新', 'success');
      setEditingProfile(false);
      await load();
    } catch {
      show('更新失败', 'error');
    }
  }

  function addTech() {
    const t = newTech.trim();
    if (t && !editTechStack.includes(t)) {
      setEditTechStack((prev) => [...prev, t]);
    }
    setNewTech('');
  }

  function removeTech(t: string) {
    setEditTechStack((prev) => prev.filter((x) => x !== t));
  }

  function addInterest() {
    const i = newInterest.trim();
    if (i && !editInterests.includes(i)) {
      setEditInterests((prev) => [...prev, i]);
    }
    setNewInterest('');
  }

  function removeInterest(i: string) {
    setEditInterests((prev) => prev.filter((x) => x !== i));
  }

  // ── Delete note knowledge ───────────────────────────────────

  async function deleteNoteKnowledge(noteId: string) {
    setDeletingNoteId(noteId);
    try {
      const res = await fetch('/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteNoteKnowledge', noteId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      show('已删除', 'success');
      await load();
    } catch {
      show('删除失败', 'error');
    }
    setDeletingNoteId(null);
  }

  // ── Delete conversation digest ──────────────────────────────

  async function deleteConversationDigest(conversationId: string, timestamp: string) {
    setDeletingDigest({ conversationId, timestamp });
    try {
      const res = await fetch('/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteConversationDigest', conversationId, timestamp }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      show('已删除', 'success');
      await load();
    } catch {
      show('删除失败', 'error');
    }
    setDeletingDigest(null);
  }

  // ── Preference edit / delete ────────────────────────────────

  function startEditPreference(key: string, value: unknown) {
    setEditingPrefKey(key);
    setEditPrefValue(typeof value === 'string' ? value : JSON.stringify(value));
  }

  function cancelEditPreference() {
    setEditingPrefKey(null);
    setEditPrefValue('');
  }

  async function savePreference(key: string) {
    let parsed: unknown = editPrefValue;
    if (editPrefValue === 'true') parsed = true;
    else if (editPrefValue === 'false') parsed = false;
    else if (!Number.isNaN(Number(editPrefValue)) && editPrefValue.trim() !== '') parsed = Number(editPrefValue);

    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updatePreference', key, value: parsed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      show('偏好已更新', 'success');
      setEditingPrefKey(null);
      await load();
    } catch {
      show('更新失败', 'error');
    }
  }

  async function deletePreference(key: string) {
    setDeletingPrefKey(key);
    try {
      const res = await fetch('/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deletePreference', key }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      show('已删除', 'success');
      await load();
    } catch {
      show('删除失败', 'error');
    }
    setDeletingPrefKey(null);
  }

  // ── Clear all ───────────────────────────────────────────────

  async function clearAll() {
    setClearing(true);
    try {
      const res = await fetch('/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clearAll' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      show('记忆已清空', 'success');
      setShowClearConfirm(false);
      await load();
    } catch {
      show('清空失败', 'error');
    }
    setClearing(false);
  }

  // ── Derived state ───────────────────────────────────────────

  const hasProfile = memory?.profile.role ||
    (memory?.profile.techStack && memory.profile.techStack.length > 0) ||
    (memory?.profile.interests && memory.profile.interests.length > 0) ||
    memory?.profile.background;

  const hasPreferences = memory && Object.keys(memory.preferences).length > 0;

  const noteKnowledgeEntries = memory
    ? Object.entries(memory.noteKnowledge).sort(
        (a, b) => new Date(b[1].lastReferencedAt).getTime() - new Date(a[1].lastReferencedAt).getTime()
      )
    : [];

  const recentDigest = memory?.conversationDigest.slice(0, 20) || [];

  // ── Render helpers ──────────────────────────────────────────

  function TagInput({
    tags,
    onRemove,
    newValue,
    onNewChange,
    onAdd,
    placeholder,
  }: {
    tags: string[];
    onRemove: (t: string) => void;
    newValue: string;
    onNewChange: (v: string) => void;
    onAdd: () => void;
    placeholder: string;
  }) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-dim)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]"
            >
              {t}
              <button onClick={() => onRemove(t)} className="text-[var(--accent)] hover:text-[var(--error)]">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newValue}
            onChange={(e) => onNewChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }}
            placeholder={placeholder}
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={onAdd}
            className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg-primary)] hover:opacity-90"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3">
        <Brain className="h-4 w-4 text-[var(--accent)]" />
        <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold tracking-wide">AI 记忆</h2>
        {memory && (
          <span className="text-xs text-[var(--text-tertiary)]">
            更新于 {formatRelative(memory.updatedAt)}
          </span>
        )}
        <button
          onClick={() => setShowClearConfirm(true)}
          disabled={loading || !memory || (!hasProfile && noteKnowledgeEntries.length === 0 && recentDigest.length === 0 && !hasPreferences)}
          className="ml-auto text-[var(--text-tertiary)] transition-colors hover:text-[var(--error)] disabled:opacity-30"
          title="一键清除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={load}
          disabled={loading}
          className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent)]"
          title="刷新"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && !memory && (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
          </div>
        )}

        {!loading && memory && (
          <div className="space-y-4 pb-6">
            {/* Empty state */}
            {!hasProfile &&
              noteKnowledgeEntries.length === 0 &&
              recentDigest.length === 0 &&
              !hasPreferences && (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] py-20">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-dim)]">
                    <Brain className="h-6 w-6 text-[var(--accent)] opacity-60" />
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-tertiary)]">还没有积累任何记忆</p>
                  <p className="mt-1 text-xs text-[var(--text-tertiary)] opacity-70">
                    与 AI 对话后，系统会自动提取你的兴趣、技术栈和偏好
                  </p>
                </div>
              )}

            {/* Profile */}
            {(hasProfile || editingProfile) && (
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-[var(--accent)]" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">用户档案</h3>
                  </div>
                  {!editingProfile ? (
                    <button
                      onClick={startEditProfile}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
                    >
                      <Pencil className="h-3 w-3" />
                      编辑
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={cancelEditProfile}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
                      >
                        <X className="h-3 w-3" />
                        取消
                      </button>
                      <button
                        onClick={saveProfile}
                        className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--bg-primary)] hover:opacity-90"
                      >
                        <Save className="h-3 w-3" />
                        保存
                      </button>
                    </div>
                  )}
                </div>

                {!editingProfile ? (
                  <div className="space-y-3">
                    {memory.profile.role && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                          角色
                        </span>
                        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{memory.profile.role}</p>
                      </div>
                    )}
                    {memory.profile.background && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                          背景
                        </span>
                        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{memory.profile.background}</p>
                      </div>
                    )}
                    {memory.profile.techStack.length > 0 && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                          技术栈
                        </span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {memory.profile.techStack.map((t) => (
                            <span
                              key={t}
                              className="rounded-md bg-[var(--accent-dim)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {memory.profile.interests.length > 0 && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                          兴趣领域
                        </span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {memory.profile.interests.map((i) => (
                            <span
                              key={i}
                              className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
                            >
                              {i}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">角色</label>
                      <input
                        type="text"
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value)}
                        placeholder="你的职业角色"
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">背景</label>
                      <textarea
                        value={editBackground}
                        onChange={(e) => setEditBackground(e.target.value)}
                        placeholder="补充背景信息"
                        rows={3}
                        className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">技术栈</label>
                      <TagInput
                        tags={editTechStack}
                        onRemove={removeTech}
                        newValue={newTech}
                        onNewChange={setNewTech}
                        onAdd={addTech}
                        placeholder="添加技术…"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">兴趣领域</label>
                      <TagInput
                        tags={editInterests}
                        onRemove={removeInterest}
                        newValue={newInterest}
                        onNewChange={setNewInterest}
                        onAdd={addInterest}
                        placeholder="添加兴趣…"
                      />
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Preferences */}
            {hasPreferences && (
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Heart className="h-4 w-4 text-[var(--accent)]" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">偏好设置</h3>
                </div>
                <div className="space-y-2">
                  {Object.entries(memory.preferences).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2">
                      {editingPrefKey === k ? (
                        <div className="flex flex-1 items-center gap-2">
                          <span className="text-xs font-medium text-[var(--text-secondary)]">{k}</span>
                          <input
                            type="text"
                            value={editPrefValue}
                            onChange={(e) => setEditPrefValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); savePreference(k); } }}
                            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                            autoFocus
                          />
                          <button onClick={() => savePreference(k)} className="text-emerald-400 hover:text-emerald-300">
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={cancelEditPreference} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="text-xs font-medium text-[var(--text-secondary)]">{k}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-[var(--text-primary)]">
                              {typeof v === 'boolean' ? (v ? '是' : '否') : String(v)}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => startEditPreference(k, v)}
                                className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent)]"
                                title="编辑"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => deletePreference(k)}
                                disabled={deletingPrefKey === k}
                                className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--error)] disabled:opacity-50"
                                title="删除"
                              >
                                {deletingPrefKey === k ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Note Knowledge */}
            {noteKnowledgeEntries.length > 0 && (
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <div className="mb-4 flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-[var(--accent)]" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    笔记认知 <span className="text-xs font-normal text-[var(--text-tertiary)]">({noteKnowledgeEntries.length})</span>
                  </h3>
                </div>
                <div className="space-y-2">
                  {noteKnowledgeEntries.map(([noteId, nk]) => {
                    const cfg = LEVEL_LABEL[nk.level] || LEVEL_FALLBACK;
                    return (
                      <div
                        key={noteId}
                        className="group relative rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 transition-colors hover:border-[var(--border-hover)]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text-primary)]">
                            {noteId}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${cfg.bg} ${cfg.color}`}>
                              {cfg.label}
                            </span>
                            <button
                              onClick={() => deleteNoteKnowledge(noteId)}
                              disabled={deletingNoteId === noteId}
                              className="text-[var(--text-tertiary)] opacity-0 transition-all hover:text-[var(--error)] group-hover:opacity-100 disabled:opacity-50"
                              title="删除"
                            >
                              {deletingNoteId === noteId ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                        {nk.notes && (
                          <p className="mt-1.5 text-xs text-[var(--text-secondary)]">{nk.notes}</p>
                        )}
                        <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
                          <span>首次 {formatRelative(nk.firstSeenAt)}</span>
                          <span>最近 {formatRelative(nk.lastReferencedAt)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Conversation Digest */}
            {recentDigest.length > 0 && (
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <div className="mb-4 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-[var(--accent)]" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    对话摘要 <span className="text-xs font-normal text-[var(--text-tertiary)]">(最近 {recentDigest.length} 条)</span>
                  </h3>
                </div>
                <div className="space-y-2">
                  {recentDigest.map((d, i) => (
                    <div
                      key={d.conversationId}
                      className="group relative rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 transition-colors hover:border-[var(--border-hover)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 text-sm text-[var(--text-primary)]">{d.summary}</p>
                        <button
                          onClick={() => deleteConversationDigest(d.conversationId, d.timestamp)}
                          disabled={
                            deletingDigest?.conversationId === d.conversationId &&
                            deletingDigest?.timestamp === d.timestamp
                          }
                          className="mt-0.5 shrink-0 text-[var(--text-tertiary)] opacity-0 transition-all hover:text-[var(--error)] group-hover:opacity-100 disabled:opacity-50"
                          title="删除"
                        >
                          {deletingDigest?.conversationId === d.conversationId &&
                          deletingDigest?.timestamp === d.timestamp ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                      {d.topics.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {d.topics.map((t) => (
                            <span
                              key={t}
                              className="rounded bg-[var(--accent-dim)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      <span className="mt-2 block text-[10px] text-[var(--text-tertiary)]">
                        {formatDate(d.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Clear all confirmation modal */}
      {showClearConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10">
                <TriangleAlert className="h-5 w-5 text-[var(--error)]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">确认清空全部记忆？</h3>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  此操作不可撤销，将删除所有档案、偏好、笔记认知和对话摘要。
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                disabled={clearing}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={clearAll}
                disabled={clearing}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--error)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
