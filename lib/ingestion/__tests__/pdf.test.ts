import { describe, it, expect, vi, beforeEach } from 'vitest';

function createMockPDFParse(opts: { title?: string; text?: string; total?: number }) {
  return vi.fn(function () {
    return {
      getInfo: vi.fn().mockResolvedValue({
        info: opts.title ? { Title: opts.title } : {},
        total: opts.total ?? 1,
      }),
      getText: vi.fn().mockResolvedValue({
        text: opts.text ?? '',
      }),
    };
  });
}

vi.mock('pdf-parse', () => ({
  PDFParse: createMockPDFParse({ title: 'My Document', text: 'Hello PDF world', total: 5 }),
}));

vi.mock('fs/promises', () => {
  const mocks = {
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake-pdf-buffer')),
  };
  return {
    ...mocks,
    default: mocks,
  } as any;
});

import { PDFParse } from 'pdf-parse';
import { readFile } from 'fs/promises';
import { extractPDF } from '../pdf';

describe('extractPDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts text, title and pages from PDF', async () => {
    const result = await extractPDF('/path/to/file.pdf');
    expect(readFile).toHaveBeenCalledWith('/path/to/file.pdf');
    expect(PDFParse).toHaveBeenCalledWith({ data: Buffer.from('fake-pdf-buffer') });
    expect(result.title).toBe('My Document');
    expect(result.content).toBe('Hello PDF world');
    expect(result.pages).toBe(5);
  });

  it('falls back to Untitled when title is missing', async () => {
    (PDFParse as any).mockImplementation(function () {
      return {
        getInfo: vi.fn().mockResolvedValue({ info: {}, total: 1 }),
        getText: vi.fn().mockResolvedValue({ text: 'No title here' }),
      };
    });

    const result = await extractPDF('/path/to/file.pdf');
    expect(result.title).toBe('Untitled PDF');
  });
});
