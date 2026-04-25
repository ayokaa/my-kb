import { FileSystemStorage } from '@/lib/storage';
import { extractPDF } from '@/lib/ingestion/pdf';
import { writeFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
import { join } from 'path';

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }

  const storage = new FileSystemStorage();

  try {
    const bytes = await file.arrayBuffer();
    const fileName = file.name;
    const fileType = file.type;

    // Save original file to attachments/
    const attachmentDir = join(process.cwd(), 'knowledge', 'attachments');
    const attachmentPath = join(attachmentDir, `${Date.now()}-${fileName}`);
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(attachmentPath, Buffer.from(bytes));

    // Extract text based on file type
    let title = fileName;
    let content = '';

    if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
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
    await storage.writeInbox({
      sourceType: fileType.startsWith('image/') ? 'image' : fileType.startsWith('audio/') ? 'audio' : 'text',
      title,
      content,
      rawMetadata: {
        original_filename: fileName,
        mime_type: fileType,
        attachment_path: attachmentPath,
      },
    });

    return Response.json({ ok: true, fileName, title });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
