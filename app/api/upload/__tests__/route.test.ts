import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/storage', () => ({
  FileSystemStorage: vi.fn(function() {
    return {
      writeInbox: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

describe('/api/upload', () => {
  it('returns 400 when no file', async () => {
    const req = new Request('http://localhost/api/upload', {
      method: 'POST',
      body: new FormData(),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('accepts text file upload', async () => {
    const file = new File(['Hello world'], 'test.txt', { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', file);

    const req = {
      formData: vi.fn().mockResolvedValue(formData),
    } as unknown as Request;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.fileName).toBe('test.txt');
  });
});
