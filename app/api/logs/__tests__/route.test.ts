import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, DELETE } from '../route';

const mockQuery = vi.hoisted(() => vi.fn());
const mockClear = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logger', () => ({
  logger: {
    query: mockQuery,
    clear: mockClear,
  },
}));

describe('/api/logs', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClear.mockReset();
  });

  describe('GET', () => {
    it('returns logs with default parameters', async () => {
      mockQuery.mockReturnValue({ logs: [{ id: '1', message: 'test' }], total: 1 });
      const req = new Request('http://localhost/api/logs');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.logs).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith({ limit: 100, offset: 0 });
    });

    it('filters by level', async () => {
      mockQuery.mockReturnValue({ logs: [], total: 0 });
      const req = new Request('http://localhost/api/logs?level=error,warn');
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({ level: ['error', 'warn'] })
      );
    });

    it('filters by module', async () => {
      mockQuery.mockReturnValue({ logs: [], total: 0 });
      const req = new Request('http://localhost/api/logs?module=Queue');
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({ module: 'Queue' }));
    });

    it('filters by search', async () => {
      mockQuery.mockReturnValue({ logs: [], total: 0 });
      const req = new Request('http://localhost/api/logs?search=failed');
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({ search: 'failed' }));
    });

    it('respects limit and offset', async () => {
      mockQuery.mockReturnValue({ logs: [], total: 0 });
      const req = new Request('http://localhost/api/logs?limit=10&offset=20');
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 20 }));
    });

    it('caps limit at 1000', async () => {
      mockQuery.mockReturnValue({ logs: [], total: 0 });
      const req = new Request('http://localhost/api/logs?limit=5000');
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000 }));
    });

    it('returns 500 on query error', async () => {
      mockQuery.mockImplementation(() => {
        throw new Error('query failed');
      });
      const req = new Request('http://localhost/api/logs');
      const res = await GET(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('query failed');
    });
  });

  describe('DELETE', () => {
    it('clears logs', async () => {
      mockClear.mockImplementation(() => {});
      const res = await DELETE();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(mockClear).toHaveBeenCalled();
    });

    it('returns 500 on clear error', async () => {
      mockClear.mockImplementation(() => {
        throw new Error('clear failed');
      });
      const res = await DELETE();
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('clear failed');
    });
  });
});
