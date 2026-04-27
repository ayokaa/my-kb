import { FileSystemStorage } from '@/lib/storage';
import { extractPDF } from '@/lib/ingestion/pdf';
import { writeFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
import { join, basename } from 'path';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
];

function sanitizeFileName(name: string): string {
  // Remove path traversal characters and control characters
  return basename(name).replace(/[\x00-\x1f\x7f]/g, '').replace(/[/\\]/g, '_');
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)` }, { status: 413 });
  }

  const fileType = file.type;
  const isExplicitlyAllowed = ALLOWED_TYPES.includes(fileType);
  const isTextByExtension = file.name.endsWith('.md') || file.name.endsWith('.txt');
  if (!isExplicitlyAllowed && !isTextByExtension) {
    return Response.json({ error: 'File type not allowed' }, { status: 415 });
  }

  const storage = new FileSystemStorage();

  try {
    const bytes = await file.arrayBuffer();
    const fileName = sanitizeFileName(file.name);

    // Save original file to attachments/
    const attachmentDir = join(process.cwd(), process.env.KNOWLEDGE_ROOT || 'knowledge', 'attachments');
    const attachmentPath = join(attachmentDir, `${Date.now()}-${fileName}`);
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(attachmentPath, Buffer.from(bytes));

    // Extract text based on file type
    let title = fileName;
    let content = '';

    if (fileType === 'application/pdf') {
      const pdf = await extractPDF(attachmentPath);
      title = pdf.title;
      content = pdf.content;
    } else if (fileType.startsWith('text/') || fileName.endsWith('.md') || fileName.endsWith('.txt')) {
      content = await file.text();
    } else {
      // For images/audio/other: store raw file, content is placeholder
      content = `[File uploaded: ${fileName}]\nType: ${fileType}\nPath: ${attachmentPath}`;
    }

    // Write to inbox
    const written = await storage.writeInbox({
      sourceType: fileType.startsWith('image/') ? 'image' : fileType.startsWith('audio/') ? 'audio' : 'text',
      title,
      content,
      rawMetadata: {
        original_filename: fileName,
        mime_type: fileType,
        attachment_path: attachmentPath,
      },
    });

    return Response.json({ ok: true, fileName, title, skipped: !written });
  } catch (err) {
    console.error('[Upload] Failed to process upload:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
