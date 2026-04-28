import { PDFParse } from 'pdf-parse';
import { readFile } from 'fs/promises';
import { join } from 'path';

// pdfjs-dist (used by pdf-parse) needs to know where the worker file is.
// In a bundled environment the relative default path breaks, so we set it
// to the absolute path inside node_modules before any PDF is parsed.
import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
  pdfjs.GlobalWorkerOptions.workerSrc = join(
    process.cwd(),
    'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
  );
});

export async function extractPDF(filePath: string): Promise<{ title: string; content: string; pages: number }> {
  const buffer = await readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  const info = await parser.getInfo();
  const textResult = await parser.getText();
  return {
    title: info.info?.Title || 'Untitled PDF',
    content: textResult.text,
    pages: info.total,
  };
}
