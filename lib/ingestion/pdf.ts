import * as pdfParse from 'pdf-parse';
const pdf = pdfParse as any;

export async function extractPDF(filePath: string): Promise<{ title: string; content: string; pages: number }> {
  const data = await pdf(filePath);
  return {
    title: data.info?.Title || 'Untitled PDF',
    content: data.text,
    pages: data.numpages,
  };
}
