'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText,
  RefreshCw,
  Trash2,
  Radio,
  RadioReceiver,
  ChevronDown,
  ChevronUp,
  Search,
  X,
} from 'lucide-react';
import type { LogEntry, LogLevel } from '@/lib/logger';

const LEVEL_CONFIG: Record<LogLevel, { label: string; color: string; bg: string; dot: string }> = {
  debug: { label: '调试', color: 'text-gray-400', bg: 'bg-gray-500/10', dot: 'bg-gray-400' },
  info: { label: '信息', color: 'text-blue-400', bg: 'bg-blue-500/10', dot: 'bg-blue-400' },
  warn: { label: '警告', color: 'text-amber-400', bg: 'bg-amber-500/10', dot: 'bg-amber-400' },
  error: { label: '错误', color: 'text-red-400', bg: 'bg-red-500/10', dot: 'bg-red-400' },
};

const LEVELS: (LogLevel | 'all')[] = ['all', 'debug', 'info', 'warn', 'error'];

interface LogsPanelProps {
  isActive?: boolean;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  } catch {
    return iso;
  }
}

export default function LogsPanel({ isActive }: LogsPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterLevel, setFilterLevel] = useState<LogLevel | 'all'>('all');
  const [filterModule, setFilterModule] = useState<string>('all');
  const [modules, setModules] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [isLive, setIsLive] = useState(true);
  const [total, setTotal] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
  const listRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const userScrolledRef = useRef(false);
  const logIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterLevel !== 'all') params.set('level', filterLevel);
      if (filterModule !== 'all') params.set('module', filterModule);
      if (search) params.set('search', search);
      params.set('limit', '100');

      const res = await fetch(`/api/logs?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      setLogs(data.logs || []);
      setTotal(data.total || 0);

      // Collect unique modules from visible logs
      const allMods = new Set<string>();
      (data.logs || []).forEach((l: LogEntry) => allMods.add(l.module));
      setModules((prev) => {
        const merged = new Set([...prev, ...allMods]);
        return Array.from(merged).sort();
      });
    } catch (err) {
      console.error('[LogsPanel] Failed to load logs:', err);
    }
    setLoading(false);
  }, [filterLevel, filterModule, search]);

  // Keep a synced Set of log ids for deduplication
  useEffect(() => {
    logIdsRef.current = new Set(logs.map((l) => l.id));
  }, [logs]);

  // Reload when tab becomes active
  useEffect(() => {
    if (isActive) {
      load();
    }
  }, [isActive, load]);

  // SSE connection with deduplication and reconnection handling
  useEffect(() => {
    if (!isLive || !isActive) {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
        setSseStatus('closed');
      }
      return;
    }

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (sseRef.current) {
        sseRef.current.close();
      }
      setSseStatus('connecting');

      const es = new EventSource('/api/logs/stream');
      sseRef.current = es;

      es.addEventListener('open', () => {
        setSseStatus('open');
      });

      es.addEventListener('history', (e) => {
        try {
          const historyLogs: LogEntry[] = JSON.parse(e.data);
          // Merge with existing logs instead of replacing, to avoid losing
          // entries that arrived via 'log' events before reconnection.
          setLogs((prev) => {
            const existingIds = new Set(prev.map((l) => l.id));
            const newOnes = historyLogs.filter((l) => !existingIds.has(l.id));
            const merged = [...newOnes, ...prev].slice(0, 1000);
            return merged;
          });
          setTotal((prev) => Math.max(prev, historyLogs.length));
          if (!userScrolledRef.current) {
            requestAnimationFrame(scrollToBottom);
          }
        } catch {
          // ignore parse errors
        }
      });

      es.addEventListener('log', (e) => {
        try {
          const entry: LogEntry = JSON.parse(e.data);
          // Deduplicate by id
          if (logIdsRef.current.has(entry.id)) return;

          setLogs((prev) => {
            const next = [entry, ...prev];
            if (next.length > 1000) next.pop();
            return next;
          });
          setTotal((prev) => prev + 1);
          if (!userScrolledRef.current) {
            requestAnimationFrame(scrollToBottom);
          }
        } catch {
          // ignore parse errors
        }
      });

      es.onerror = () => {
        setSseStatus('closed');
        es.close();
        sseRef.current = null;
        // Browser stops auto-reconnect on explicit close, so we retry manually
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      setSseStatus('closed');
    };
  }, [isLive, isActive]);

  // Scroll handling
  const scrollToBottom = () => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  };

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 50;
    userScrolledRef.current = !nearBottom;
    setShowScrollToBottom(!nearBottom);
  };

  const handleClear = async () => {
    try {
      await fetch('/api/logs', { method: 'DELETE' });
      setLogs([]);
      setTotal(0);
    } catch (err) {
      console.error('[LogsPanel] Failed to clear logs:', err);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredLogs = logs.filter((log) => {
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    if (filterModule !== 'all' && log.module !== filterModule) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const levelCounts = {
    all: logs.length,
    debug: logs.filter((l) => l.level === 'debug').length,
    info: logs.filter((l) => l.level === 'info').length,
    warn: logs.filter((l) => l.level === 'warn').length,
    error: logs.filter((l) => l.level === 'error').length,
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3">
        <FileText className="h-4 w-4 text-[var(--accent)]" />
        <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold tracking-wide">运行日志</h2>
        <span className="rounded-md bg-[var(--accent-dim)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">{total}</span>

        {/* Level filters */}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              onClick={() => setFilterLevel(lvl)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                filterLevel === lvl
                  ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                  : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {lvl === 'all' ? '全部' : LEVEL_CONFIG[lvl as LogLevel].label}
              {levelCounts[lvl as LogLevel | 'all'] > 0 && (
                <span className="ml-1">{levelCounts[lvl as LogLevel | 'all']}</span>
              )}
            </button>
          ))}
        </div>

        {/* Module filter */}
        {modules.length > 0 && (
          <select
            value={filterModule}
            onChange={(e) => setFilterModule(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent)]"
          >
            <option value="all">全部模块</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索日志..."
            className="input-dark h-7 w-32 rounded-md pl-7 pr-6 text-[11px] md:w-40"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Live toggle */}
        <button
          onClick={() => setIsLive((v) => !v)}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
            isLive
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
          }`}
        >
          {isLive ? <Radio className="h-3 w-3" /> : <RadioReceiver className="h-3 w-3" />}
          {isLive ? '实时' : '暂停'}
          {isLive && sseStatus === 'connecting' && (
            <span className="ml-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
          )}
          {isLive && sseStatus === 'open' && (
            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
          )}
          {isLive && sseStatus === 'closed' && (
            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-red-400" />
          )}
        </button>

        <button
          onClick={load}
          disabled={loading}
          className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent)]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>

        <button
          onClick={handleClear}
          className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--error)]"
          title="清空日志"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Log list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4"
      >
        {filteredLogs.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <FileText className="h-8 w-8 text-[var(--text-tertiary)]" />
            <p className="mt-3 text-sm text-[var(--text-tertiary)]">
              {logs.length === 0 ? '还没有日志' : '无匹配结果'}
            </p>
          </div>
        )}

        <div className="space-y-1">
          {filteredLogs.map((log) => {
            const cfg = LEVEL_CONFIG[log.level];
            const isExpanded = expandedIds.has(log.id);
            const hasMetadata = log.metadata && Object.keys(log.metadata).length > 0;

            return (
              <div
                key={log.id}
                className={`group flex items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-[var(--border)] hover:bg-[var(--bg-elevated)] ${
                  log.level === 'error' ? 'bg-red-500/[0.03]' : ''
                }`}
              >
                {/* Level dot */}
                <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${cfg.dot}`} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]" title={log.timestamp}>
                      {formatTime(log.timestamp)}
                    </span>
                    <span className={`rounded px-1 py-0.5 text-[9px] font-semibold ${cfg.bg} ${cfg.color}`}>
                      {log.module}
                    </span>
                    <span className="text-xs text-[var(--text-primary)]">{log.message}</span>
                  </div>

                  {hasMetadata && (
                    <button
                      onClick={() => toggleExpand(log.id)}
                      className="mt-1 flex items-center gap-0.5 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--accent)]"
                    >
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {isExpanded ? '收起' : '详情'}
                    </button>
                  )}

                  {isExpanded && hasMetadata && (
                    <pre className="mt-1 overflow-x-auto rounded border border-[var(--border)] bg-[var(--bg-primary)] p-2 text-[10px] text-[var(--text-secondary)]">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Scroll to bottom */}
        {showScrollToBottom && (
          <button
            onClick={() => {
              scrollToBottom();
              userScrolledRef.current = false;
            }}
            className="sticky bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1.5 text-[10px] font-medium text-white shadow-lg transition-opacity hover:opacity-90"
          >
            <ChevronDown className="h-3 w-3" />
            回到底部
          </button>
        )}
      </div>
    </div>
  );
}
