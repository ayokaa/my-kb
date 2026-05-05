import { describe, it, expect } from 'vitest';
import {
  emptyMemory,
  mergeMemory,
  getChatContext,
  computeNoteStatus,
  type UserMemory,
  type MemoryExtractResult,
  type NoteKnowledge,
} from '../memory';

describe('memory module', () => {
  describe('emptyMemory', () => {
    it('returns a valid empty memory structure', () => {
      const m = emptyMemory();
      expect(m.profile.interests).toEqual([]);
      expect(m.noteKnowledge).toEqual({});
      expect(m.conversationDigest).toEqual('');
      expect(m.preferences).toEqual({});
      expect(m.updatedAt).toBeTruthy();
    });
  });

  describe('mergeMemory', () => {
    it('applies profileChanges', () => {
      const current = emptyMemory();
      const extract: MemoryExtractResult = {
        profileChanges: {
          role: '全栈开发者',
          interests: ['RAG'],
        },
      };

      const merged = mergeMemory(current, extract, 'conv-1');
      expect(merged.profile.role).toBe('全栈开发者');
      expect(merged.profile.interests).toEqual(['RAG']);
    });

    it('deduplicates interests on merge', () => {
      const current = emptyMemory();
      current.profile.interests = ['RAG'];

      const extract: MemoryExtractResult = {
        profileChanges: {
          interests: ['RAG', '性能优化'],
        },
      };

      const merged = mergeMemory(current, extract, 'conv-2');
      expect(merged.profile.interests).toEqual(['RAG', '性能优化']);
    });

    it('updates noteKnowledge per-note', () => {
      const current = emptyMemory();
      const extract: MemoryExtractResult = {
        noteFamiliarity: [
          { noteId: 'rag-overview', level: 'discussed', notes: '理解基本概念' },
        ],
      };

      const merged = mergeMemory(current, extract, 'conv-1');
      expect(merged.noteKnowledge['rag-overview'].level).toBe('discussed');
      expect(merged.noteKnowledge['rag-overview'].notes).toBe('理解基本概念');
      expect(merged.noteKnowledge['rag-overview'].firstSeenAt).toBeTruthy();
    });

    it('preserves firstSeenAt when updating existing note knowledge', () => {
      const current = emptyMemory();
      const first: MemoryExtractResult = {
        noteFamiliarity: [
          { noteId: 'rag-overview', level: 'referenced', notes: '首次接触' },
        ],
      };
      const merged1 = mergeMemory(current, first, 'conv-1');
      const firstSeen = merged1.noteKnowledge['rag-overview'].firstSeenAt;

      const second: MemoryExtractResult = {
        noteFamiliarity: [
          { noteId: 'rag-overview', level: 'discussed', notes: '深入讨论了' },
        ],
      };
      const merged2 = mergeMemory(merged1, second, 'conv-2');

      expect(merged2.noteKnowledge['rag-overview'].level).toBe('discussed');
      expect(merged2.noteKnowledge['rag-overview'].firstSeenAt).toBe(firstSeen);
    });

    it('appends newDigest to recentDigests and updates conversationDigest via recentDiscussion', () => {
      const current = emptyMemory();
      const extract1: MemoryExtractResult = {
        newDigest: '第一次讨论了 React',
        recentDiscussion: '用户最近在研究 React 19 的新特性。',
      };
      const merged1 = mergeMemory(current, extract1, 'conv-1');
      expect(merged1.recentDigests.length).toBe(1);
      expect(merged1.recentDigests[0]).toContain('第一次讨论了 React');
      expect(merged1.conversationDigest).toBe('用户最近在研究 React 19 的新特性。');

      const extract2: MemoryExtractResult = {
        newDigest: '第二次讨论了 RAG',
        recentDiscussion: '用户最近在研究 React 19，同时关注 RAG 检索优化。',
      };
      const merged2 = mergeMemory(merged1, extract2, 'conv-2');
      expect(merged2.recentDigests.length).toBe(2);
      expect(merged2.conversationDigest).toBe('用户最近在研究 React 19，同时关注 RAG 检索优化。');
    });

    it('applies preferenceSignals', () => {
      const current = emptyMemory();
      const extract: MemoryExtractResult = {
        preferenceSignals: { detailLevel: 'detailed', preferCodeExamples: true },
      };

      const merged = mergeMemory(current, extract, 'conv-1');
      expect(merged.preferences.detailLevel).toBe('detailed');
      expect(merged.preferences.preferCodeExamples).toBe(true);
    });

    it('handles empty extract (nothing changed)', () => {
      const current = emptyMemory();
      current.profile.role = 'dev';

      const extract: MemoryExtractResult = {};
      const merged = mergeMemory(current, extract, 'conv-1');

      expect(merged.profile.role).toBe('dev');
      expect(merged.conversationDigest).toBe('');
    });

    it('prepends date prefix to newDigest in recentDigests', () => {
      const current = emptyMemory();
      const extract: MemoryExtractResult = {
        newDigest: '讨论了 React',
      };
      const merged = mergeMemory(current, extract, 'conv-1');
      expect(merged.recentDigests.length).toBe(1);
      const today = new Date().toISOString().slice(0, 10);
      expect(merged.recentDigests[0]).toMatch(new RegExp(`^${today} \\| 讨论了 React$`));
    });

    it('filters out digests older than 7 days', () => {
      const current = emptyMemory();
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 8);
      const oldDateStr = oldDate.toISOString().slice(0, 10);
      current.recentDigests = [
        `${oldDateStr} | 旧的摘要 1`,
        `${oldDateStr} | 旧的摘要 2`,
      ];

      const extract: MemoryExtractResult = {
        newDigest: '新的讨论',
      };
      const merged = mergeMemory(current, extract, 'conv-1');

      // 旧摘要被过滤，只剩下新的
      expect(merged.recentDigests.length).toBe(1);
      expect(merged.recentDigests[0]).toContain('新的讨论');
    });

    it('keeps digests within 7 days', () => {
      const current = emptyMemory();
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 3);
      const recentDateStr = recentDate.toISOString().slice(0, 10);
      current.recentDigests = [
        `${recentDateStr} | 3天前的摘要`,
      ];

      const extract: MemoryExtractResult = {
        newDigest: '今天的讨论',
      };
      const merged = mergeMemory(current, extract, 'conv-1');

      expect(merged.recentDigests.length).toBe(2);
      expect(merged.recentDigests[0]).toContain('今天的讨论');
      expect(merged.recentDigests[1]).toContain('3天前的摘要');
    });
  });

  describe('getChatContext', () => {
    function makeMemory(overrides?: Partial<UserMemory>): UserMemory {
      return { ...emptyMemory(), ...overrides };
    }

    it('returns null for empty memory with no relevant notes', () => {
      const m = emptyMemory();
      expect(getChatContext(m, [])).toBeNull();
    });

    it('includes profile when populated', () => {
      const m = makeMemory({
        profile: {
          role: '研究员',
          interests: ['AI'],
          background: '',
        },
      });
      const ctx = getChatContext(m, []);
      expect(ctx).toContain('研究员');
      expect(ctx).toContain('AI');
    });

    it('includes recentDiscussion from conversationDigest', () => {
      const m = makeMemory({
        conversationDigest: '用户最近在研究 React 19 新特性，同时关注 RAG 检索优化。',
      });
      const ctx = getChatContext(m, []);
      expect(ctx).toContain('用户最近在研究 React 19 新特性');
      expect(ctx).toContain('RAG 检索优化');
    });

    it('includes relevant note knowledge', () => {
      const m = makeMemory({
        noteKnowledge: {
          'rag-overview': {
            level: 'discussed',
            firstSeenAt: '',
            lastReferencedAt: '',
            notes: '理解基本概念',
          },
          'vector-db': {
            level: 'referenced',
            firstSeenAt: '',
            lastReferencedAt: '',
            notes: '初步了解',
          },
        },
      });

      const ctx = getChatContext(m, ['rag-overview']);
      expect(ctx).toContain('rag-overview');
      expect(ctx).toContain('理解基本概念');
      expect(ctx).not.toContain('vector-db');
    });

    it('limits relevant notes to 5', () => {
      const ids = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'];
      const noteKnowledge: Record<string, any> = {};
      for (const id of ids) {
        noteKnowledge[id] = { level: 'aware' as const, firstSeenAt: '', lastReferencedAt: '', notes: id };
      }
      const m = makeMemory({ noteKnowledge });

      const ctx = getChatContext(m, ids);
      // Only 5 should be included
      expect(ctx).toContain('n1');
      expect(ctx).toContain('n5');
      expect(ctx).not.toContain('n6');
    });
  });

  describe('computeNoteStatus', () => {
    function nk(level: NoteKnowledge['level'], daysAgo = 0): NoteKnowledge {
      const d = new Date(Date.now() - daysAgo * 86400000).toISOString();
      return { level, firstSeenAt: d, lastReferencedAt: d, notes: 'test' };
    }

    it('seed → growing when user has encountered the note', () => {
      expect(computeNoteStatus('seed', nk('referenced'), Date.now())).toBe('growing');
      expect(computeNoteStatus('seed', nk('discussed'), Date.now())).toBe('growing');
    });

    it('seed stays seed when only aware', () => {
      expect(computeNoteStatus('seed', nk('aware'), Date.now())).toBeNull();
    });

    it('seed stays seed when no knowledge', () => {
      expect(computeNoteStatus('seed', undefined, Date.now())).toBeNull();
    });

    it('growing → evergreen when user discussed', () => {
      expect(computeNoteStatus('growing', nk('discussed'), Date.now())).toBe('evergreen');
    });

    it('growing stays growing when only referenced', () => {
      expect(computeNoteStatus('growing', nk('referenced'), Date.now())).toBeNull();
    });

    it('growing → seed when knowledge is removed', () => {
      expect(computeNoteStatus('growing', undefined, Date.now())).toBe('seed');
    });

    it('evergreen → stale after 30 days without reference', () => {
      expect(computeNoteStatus('evergreen', nk('discussed', 31), Date.now())).toBe('stale');
    });

    it('evergreen stays evergreen within 30 days', () => {
      expect(computeNoteStatus('evergreen', nk('discussed', 29), Date.now())).toBeNull();
    });

    it('evergreen → seed when knowledge is removed', () => {
      expect(computeNoteStatus('evergreen', undefined, Date.now())).toBe('seed');
    });

    it('stale → growing when user references again', () => {
      expect(computeNoteStatus('stale', nk('referenced'), Date.now())).toBe('growing');
    });

    it('stale → seed when knowledge is removed', () => {
      expect(computeNoteStatus('stale', undefined, Date.now())).toBe('seed');
    });

    it('archived never changes', () => {
      expect(computeNoteStatus('archived', nk('discussed'), Date.now())).toBeNull();
      expect(computeNoteStatus('archived', undefined, Date.now())).toBeNull();
    });
  });
});
