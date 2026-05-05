import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import * as lucide from 'lucide-react';
import MemoryPanel from '../MemoryPanel';



describe('MemoryPanel icon imports', () => {
  it('uses only icons that exist in lucide-react', () => {
    const usedIcons = [
      'Brain', 'Loader2', 'RefreshCw', 'User', 'BookOpen', 'MessageSquare',
      'Heart', 'Pencil', 'Trash2', 'Plus', 'X', 'Check', 'Save', 'TriangleAlert',
    ];
    for (const name of usedIcons) {
      const icon = (lucide as any)[name];
      expect(icon, `Icon "${name}" must exist in lucide-react`).toBeDefined();
      expect(typeof icon).toBe('object');
    }
  });
});

describe('MemoryPanel rendering', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows title while loading', () => {
    (global.fetch as any).mockReturnValue(new Promise(() => {}));
    render(<MemoryPanel isActive />);
    expect(document.body.textContent).toContain('AI 记忆');
  });

  it('shows empty state when no memory data', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        profile: { techStack: [], interests: [] },
        noteKnowledge: {},
        conversationDigest: '',
        preferences: {},
        updatedAt: new Date().toISOString(),
      }),
    });

    render(<MemoryPanel isActive />);
    await waitFor(() => {
      expect(document.body.textContent).toContain('还没有积累任何记忆');
    });
  });

  it('renders conversation digest as string', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        profile: { techStack: [], interests: [] },
        noteKnowledge: {},
        conversationDigest: '最近讨论了 RAG 检索和 agent 架构设计',
        preferences: {},
        updatedAt: new Date().toISOString(),
      }),
    });

    render(<MemoryPanel isActive />);
    await waitFor(() => {
      expect(document.body.textContent).toContain('最近讨论');
      expect(document.body.textContent).toContain('最近讨论了 RAG 检索和 agent 架构设计');
    });
  });

  it('renders profile section when populated', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        profile: {
          role: '开发者',
          techStack: ['TypeScript'],
          interests: ['AI'],
          background: '背景信息',
        },
        noteKnowledge: {},
        conversationDigest: '',
        preferences: {},
        updatedAt: new Date().toISOString(),
      }),
    });

    render(<MemoryPanel isActive />);
    await waitFor(() => {
      expect(document.body.textContent).toContain('用户档案');
      expect(document.body.textContent).toContain('开发者');
      expect(document.body.textContent).toContain('TypeScript');
      expect(document.body.textContent).toContain('AI');
      expect(document.body.textContent).toContain('背景信息');
    });
  });

  it('calls delete API when digest delete button clicked', async () => {
    const mockFetch = vi.fn((url: string, init?: any) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          profile: { techStack: [], interests: [] },
          noteKnowledge: {},
          conversationDigest: '测试摘要',
          preferences: {},
          updatedAt: new Date().toISOString(),
        }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<MemoryPanel isActive />);
    await waitFor(() => {
      expect(document.body.textContent).toContain('测试摘要');
    });

    // click the delete button inside the digest section
    const deleteBtn = screen.getByTitle('删除');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/memory',
        expect.objectContaining({
          method: 'DELETE',
          body: expect.stringContaining('deleteConversationDigest'),
        })
      );
    });
  });
});
