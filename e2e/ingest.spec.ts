import { test, expect } from './fixtures';
import { resetTestData } from './fixtures';

test.describe.serial('Ingest', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('can ingest text via UI', async ({ page }) => {
    await page.goto('/');

    await page.getByText('添加知识').click();
    await expect(page.getByText('文本')).toBeVisible();

    await page.getByPlaceholder('标题（可选）').fill('UI Ingest Test');
    await page.getByPlaceholder('输入文本内容...').fill('Content added through the UI ingest form.');

    await page.getByRole('button', { name: '入库' }).click();

    await page.getByText('收件箱').click();
    await expect(page.getByText('UI Ingest Test').first()).toBeVisible();
  });

  test('ingest link form is present and submittable', async ({ page }) => {
    await page.goto('/');

    await page.getByText('添加知识').click();
    await page.getByText('链接').click();

    const linkInput = page.getByPlaceholder('https://...');
    await expect(linkInput).toBeVisible();
    await expect(linkInput).toBeEnabled();

    await linkInput.fill('https://example.com/article');

    const submitBtn = page.locator('button', { hasText: '抓取' });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeEnabled();
  });

  test('ingest tabs can be switched', async ({ page }) => {
    await page.goto('/');

    await page.getByText('添加知识').click();

    await expect(page.getByPlaceholder('输入文本内容...')).toBeVisible();

    await page.getByText('链接').click();
    await expect(page.getByPlaceholder('https://...')).toBeVisible();

    await page.getByText('文件').click();

    await page.getByText('文本').click();
    await expect(page.getByPlaceholder('输入文本内容...')).toBeVisible();
  });

  test('RSS tab is present in ingest panel', async ({ page }) => {
    await page.goto('/');

    await page.getByText('添加知识').click();
    await expect(page.getByText('RSS')).toBeVisible();
  });

  test('submitting link shows queued message', async ({ page }) => {
    await page.goto('/');

    await page.getByText('添加知识').click();
    await page.getByText('链接').click();

    await page.getByPlaceholder('https://...').fill('https://example.com/article');
    await page.getByRole('button', { name: '抓取' }).click();

    // Should show success feedback (either queued or immediate result)
    await expect(page.locator('p').filter({ hasText: /已入库|已加入/ }).first()).toBeVisible({ timeout: 5000 });
  });

  test('submit button is disabled when link input is empty', async ({ page }) => {
    await page.goto('/');

    await page.getByText('添加知识').click();
    await page.getByText('链接').click();

    const submitBtn = page.getByRole('button', { name: '抓取' });
    await expect(submitBtn).toBeDisabled();

    await page.getByPlaceholder('https://...').fill('https://example.com');
    await expect(submitBtn).toBeEnabled();
  });

  test('text submit button is disabled when content is empty', async ({ page }) => {
    await page.goto('/');

    await page.getByText('添加知识').click();

    const submitBtn = page.getByRole('button', { name: '入库' });
    await expect(submitBtn).toBeDisabled();

    await page.getByPlaceholder('输入文本内容...').fill('Some content');
    await expect(submitBtn).toBeEnabled();
  });
});
