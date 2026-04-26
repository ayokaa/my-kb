import { test as base, expect } from '@playwright/test';
import { rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

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
