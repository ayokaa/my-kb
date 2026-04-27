import { test as base, expect } from '@playwright/test';
import { rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { stringifyNote } from '../lib/parsers';
import type { Note } from '../lib/types';

export async function resetTestData() {
  const root = join(process.cwd(), 'knowledge-test');
  await rm(root, { recursive: true, force: true });
  await mkdir(join(root, 'inbox'), { recursive: true });
  await mkdir(join(root, 'archive', 'inbox'), { recursive: true });
  await mkdir(join(root, 'notes'), { recursive: true });
  await mkdir(join(root, 'conversations'), { recursive: true });
  await mkdir(join(root, 'meta'), { recursive: true });
  await mkdir(join(root, 'attachments'), { recursive: true });
  await writeFile(
    join(root, 'meta', 'queue.json'),
    JSON.stringify({ tasks: [], pendingIds: [] }, null, 2)
  );
  await writeFile(
    join(root, 'meta', 'rss-sources.yml'),
    '[]\n'
  );
}

export async function createTestNote(note: Partial<Note> & { id: string; title: string }) {
  const root = join(process.cwd(), 'knowledge-test');
  const fullNote: Note = {
    id: note.id,
    title: note.title,
    tags: note.tags ?? [],
    status: note.status ?? 'seed',
    created: note.created ?? new Date().toISOString(),
    updated: note.updated ?? new Date().toISOString(),
    sources: note.sources ?? [],
    summary: note.summary ?? '',
    personalContext: note.personalContext ?? '',
    keyFacts: note.keyFacts ?? [],
    timeline: note.timeline ?? [],
    links: note.links ?? [],
    backlinks: note.backlinks ?? [],
    qas: note.qas ?? [],
    content: note.content ?? '',
    filePath: join(root, 'notes', `${note.id}.md`),
  };
  const content = stringifyNote(fullNote);
  await writeFile(fullNote.filePath, content);
  return fullNote;
}

export const test = base.extend({
  page: async ({ page }, use) => {
    // Intercept Google Fonts to prevent load event blocking in headless CI
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, body: '', headers: { 'content-type': 'text/css' } })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, body: '', headers: { 'content-type': 'font/woff2' } })
    );
    await use(page);
  },
});

export { expect };
