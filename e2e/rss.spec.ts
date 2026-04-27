import { test, expect } from './fixtures';
import { resetTestData } from './fixtures';
import { writeFile } from 'fs/promises';
import { join } from 'path';

test.describe.serial('RSS Subscriptions', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('RSS panel shows empty state', async ({ page }) => {
    await page.goto('/');
    await page.getByText('订阅').click();

    await expect(page.getByText('RSS 订阅')).toBeVisible();
    await expect(page.getByText('还没有订阅源')).toBeVisible();
  });

  test('can add a subscription', async ({ page }) => {
    await page.goto('/');
    await page.getByText('订阅').click();

    const urlInput = page.getByPlaceholder('RSS URL');
    await urlInput.fill('https://overreacted.io/rss.xml');

    const nameInput = page.getByPlaceholder('名称（可选）');
    await nameInput.fill('Overreacted');

    await page.locator('form').filter({ has: urlInput }).locator('button[type="submit"]').click();

    await expect(page.getByText('Overreacted', { exact: true })).toBeVisible();
    await expect(page.getByText('https://overreacted.io/rss.xml', { exact: true })).toBeVisible();
  });

  test('can remove a subscription', async ({ page, request }) => {
    // Seed subscription via API to avoid UI add/remove interaction issues
    await request.post('/api/rss/subscriptions', {
      data: { url: 'https://example.com/feed.xml', name: 'Test Feed' },
    });

    await page.goto('/');
    await page.getByText('订阅').click();

    await expect(page.getByText('Test Feed', { exact: true })).toBeVisible();

    // Remove
    await page.getByRole('button', { name: '删除订阅' }).click();

    await expect(page.getByText('Test Feed', { exact: true })).not.toBeVisible();
    await expect(page.getByText('还没有订阅源')).toBeVisible();
  });

  test('can import OPML file', async ({ page }) => {
    await page.goto('/');
    await page.getByText('订阅').click();

    const opmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline type="rss" text="Test Blog" xmlUrl="https://testblog.example.com/feed.xml" />
    <outline type="rss" text="Another Blog" xmlUrl="https://another.example.com/rss.xml" />
  </body>
</opml>`;

    const tmpFile = join(process.cwd(), 'knowledge-test', 'attachments', 'e2e-subscriptions.opml');
    await writeFile(tmpFile, opmlContent);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(tmpFile);

    // After import, subscriptions should appear
    await expect(page.getByText('Test Blog', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Another Blog', { exact: true })).toBeVisible();
  });

  test('check all button is disabled when no subscriptions', async ({ page }) => {
    await page.goto('/');
    await page.getByText('订阅').click();

    const checkBtn = page.getByRole('button', { name: '检查更新' });
    await expect(checkBtn).toBeDisabled();
  });
});
