import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpDir = mkdtempSync(join(tmpdir(), 'kb-memory-api-test-'));
process.env.KNOWLEDGE_ROOT = tmpDir;

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET, POST, DELETE } from '../route';
import { saveMemory, emptyMemory } from '@/lib/memory';

beforeEach(async () => {
  // Clear memory file
  try {
    const fs = await import('fs/promises');
    await fs.unlink(join(tmpDir, 'meta', 'user-memory.json'));
  } catch {
    // File may not exist
  }
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('/api/memory', () => {
  describe('GET', () => {
    it('returns empty memory when no file exists', async () => {
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.profile.techStack).toEqual([]);
      expect(data.profile.interests).toEqual([]);
      expect(data.noteKnowledge).toEqual({});
      expect(data.conversationDigest).toEqual([]);
      expect(data.preferences).toEqual({});
    });

    it('returns persisted memory', async () => {
      const memory = emptyMemory();
      memory.profile.role = '开发者';
      memory.profile.techStack = ['TypeScript'];
      memory.preferences.detailLevel = 'concise';
      await saveMemory(memory);

      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.profile.role).toBe('开发者');
      expect(data.profile.techStack).toEqual(['TypeScript']);
      expect(data.preferences.detailLevel).toBe('concise');
    });
  });

  describe('POST updateProfile', () => {
    it('updates profile fields', async () => {
      const memory = emptyMemory();
      memory.profile.role = 'old-role';
      await saveMemory(memory);

      const req = new Request('http://localhost/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateProfile',
          profile: {
            role: '研究员',
            background: 'AI 实验室',
            techStack: ['Python', 'PyTorch'],
            interests: ['深度学习', 'NLP'],
          },
        }),
      });

      const res = await POST(req);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);

      const getRes = await GET();
      const getData = await getRes.json();
      expect(getData.profile.role).toBe('研究员');
      expect(getData.profile.background).toBe('AI 实验室');
      expect(getData.profile.techStack).toEqual(['Python', 'PyTorch']);
      expect(getData.profile.interests).toEqual(['深度学习', 'NLP']);
      expect(getData.profile.updatedAt).toBeTruthy();
    });

    it('clears role and background when set to empty string', async () => {
      const memory = emptyMemory();
      memory.profile.role = 'dev';
      memory.profile.background = 'bg';
      await saveMemory(memory);

      const req = new Request('http://localhost/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateProfile',
          profile: { role: '', background: '', techStack: [], interests: [] },
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const getRes = await GET();
      const getData = await getRes.json();
      expect(getData.profile.role).toBeUndefined();
      expect(getData.profile.background).toBeUndefined();
    });
  });

  describe('POST updatePreference', () => {
    it('adds and updates preferences', async () => {
      const req = new Request('http://localhost/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updatePreference', key: 'theme', value: 'dark' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const getRes = await GET();
      const getData = await getRes.json();
      expect(getData.preferences.theme).toBe('dark');
    });

    it('rejects missing key', async () => {
      const req = new Request('http://localhost/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updatePreference', value: 'x' }),
      });

      const res = await POST(req);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toContain('key is required');
    });
  });

  describe('DELETE deleteNoteKnowledge', () => {
    it('removes a note knowledge entry', async () => {
      const memory = emptyMemory();
      memory.noteKnowledge['rag-overview'] = {
        level: 'discussed',
        firstSeenAt: new Date().toISOString(),
        lastReferencedAt: new Date().toISOString(),
        notes: 'test',
      };
      await saveMemory(memory);

      const req = new Request('http://localhost/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteNoteKnowledge', noteId: 'rag-overview' }),
      });

      const res = await DELETE(req);
      expect(res.status).toBe(200);

      const getRes = await GET();
      const getData = await getRes.json();
      expect(getData.noteKnowledge['rag-overview']).toBeUndefined();
    });

    it('rejects missing noteId', async () => {
      const req = new Request('http://localhost/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteNoteKnowledge' }),
      });

      const res = await DELETE(req);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toContain('noteId is required');
    });
  });

  describe('DELETE deleteConversationDigest', () => {
    it('removes matching digest entry', async () => {
      const memory = emptyMemory();
      memory.conversationDigest = [
        { conversationId: 'c1', summary: 'A', topics: [], timestamp: '2024-01-01T00:00:00Z' },
        { conversationId: 'c2', summary: 'B', topics: [], timestamp: '2024-01-02T00:00:00Z' },
      ];
      await saveMemory(memory);

      const req = new Request('http://localhost/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deleteConversationDigest',
          conversationId: 'c1',
          timestamp: '2024-01-01T00:00:00Z',
        }),
      });

      const res = await DELETE(req);
      expect(res.status).toBe(200);

      const getRes = await GET();
      const getData = await getRes.json();
      expect(getData.conversationDigest).toHaveLength(1);
      expect(getData.conversationDigest[0].summary).toBe('B');
    });

    it('rejects missing parameters', async () => {
      const req = new Request('http://localhost/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteConversationDigest', conversationId: 'c1' }),
      });

      const res = await DELETE(req);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toContain('conversationId and timestamp are required');
    });
  });

  describe('DELETE deletePreference', () => {
    it('removes a preference key', async () => {
      const memory = emptyMemory();
      memory.preferences.theme = 'dark';
      await saveMemory(memory);

      const req = new Request('http://localhost/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deletePreference', key: 'theme' }),
      });

      const res = await DELETE(req);
      expect(res.status).toBe(200);

      const getRes = await GET();
      const getData = await getRes.json();
      expect(getData.preferences.theme).toBeUndefined();
    });

    it('rejects missing key', async () => {
      const req = new Request('http://localhost/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deletePreference' }),
      });

      const res = await DELETE(req);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toContain('key is required');
    });
  });

  describe('DELETE clearAll', () => {
    it('resets all memory to empty', async () => {
      const memory = emptyMemory();
      memory.profile.role = 'dev';
      memory.profile.techStack = ['TS'];
      memory.noteKnowledge['n1'] = { level: 'discussed', firstSeenAt: '', lastReferencedAt: '', notes: '' };
      memory.conversationDigest.push({ conversationId: 'c1', summary: 'A', topics: [], timestamp: '' });
      memory.preferences.theme = 'dark';
      await saveMemory(memory);

      const req = new Request('http://localhost/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clearAll' }),
      });

      const res = await DELETE(req);
      expect(res.status).toBe(200);

      const getRes = await GET();
      const getData = await getRes.json();
      expect(getData.profile.role).toBeUndefined();
      expect(getData.profile.techStack).toEqual([]);
      expect(getData.noteKnowledge).toEqual({});
      expect(getData.conversationDigest).toEqual([]);
      expect(getData.preferences).toEqual({});
    });
  });

  describe('unknown action', () => {
    it('returns 400 for POST with unknown action', async () => {
      const req = new Request('http://localhost/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unknown' }),
      });

      const res = await POST(req);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe('Unknown action');
    });

    it('returns 400 for DELETE with unknown action', async () => {
      const req = new Request('http://localhost/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unknown' }),
      });

      const res = await DELETE(req);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe('Unknown action');
    });
  });
});
