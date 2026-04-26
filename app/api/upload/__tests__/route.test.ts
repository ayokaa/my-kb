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

  it('rejects path traversal in file name', async () => {
    const file = new File(['content'], '../../../etc/passwd', { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', file);

    const req = {
      formData: vi.fn().mockResolvedValue(formData),
    } as unknown as Request;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    // basename() strips path traversal, so only 'passwd' remains;
    // the file is saved inside attachments/ regardless of malicious name
    expect(data.fileName).not.toContain('/');
    expect(data.fileName).not.toContain('\\');
    expect(data.fileName).toBe('passwd');
  });

  it('rejects oversized files', async () => {
    const bigContent = new Uint8Array(11 * 1024 * 1024); // 11 MB
    const file = new File([bigContent], 'big.pdf', { type: 'application/pdf' });
    const formData = new FormData();
    formData.append('file', file);

    const req = {
      formData: vi.fn().mockResolvedValue(formData),
    } as unknown as Request;

    const res = await POST(req);
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toContain('too large');
  });

  it('rejects disallowed file types', async () => {
    const file = new File(['MZ'], 'malware.exe', { type: 'application/x-msdownload' });
    const formData = new FormData();
    formData.append('file', file);

    const req = {
      formData: vi.fn().mockResolvedValue(formData),
    } as unknown as Request;

    const res = await POST(req);
    expect(res.status).toBe(415);
    const data = await res.json();
    expect(data.error).toContain('not allowed');
  });
});
