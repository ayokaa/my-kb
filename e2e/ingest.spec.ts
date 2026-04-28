import { test, expect } from './fixtures';
import { resetTestData } from './fixtures';

test.describe.serial('Ingest', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('can ingest text via UI', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-ingest').click();
    await expect(page.getByTestId('ingest-tab-text')).toBeVisible();

    await page.getByPlaceholder('标题（可选）').fill('UI Ingest Test');
    await page.getByPlaceholder('输入文本内容...').fill('Content added through the UI ingest form.');

    await page.getByRole('button', { name: '入库' }).click();

    // Wait for success feedback (async enqueue returns quickly)
    await expect(page.locator('p').filter({ hasText: /已入库|已加入/ }).first()).toBeVisible({ timeout: 5000 });
  });

  test('ingest link form is present and submittable', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-ingest').click();
    await page.getByTestId('ingest-tab-link').click();

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

    await page.getByTestId('nav-ingest').click();

    await expect(page.getByPlaceholder('输入文本内容...')).toBeVisible();

    await page.getByTestId('ingest-tab-link').click();
    await expect(page.getByPlaceholder('https://...')).toBeVisible();

    await page.getByTestId('ingest-tab-file').click();

    await page.getByTestId('ingest-tab-text').click();
    await expect(page.getByPlaceholder('输入文本内容...')).toBeVisible();
  });

  test('RSS tab is present in ingest panel', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-ingest').click();
    await expect(page.getByTestId('ingest-tab-rss')).toBeVisible();
  });

  test('submitting link shows queued message', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-ingest').click();
    await page.getByTestId('ingest-tab-link').click();

    await page.getByPlaceholder('https://...').fill('https://example.com/article');
    await page.getByRole('button', { name: '抓取' }).click();

    // Should show success feedback (task enqueued)
    await expect(page.locator('p').filter({ hasText: /已入库|已加入/ }).first()).toBeVisible({ timeout: 5000 });
  });

  test('submit button is disabled when link input is empty', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-ingest').click();
    await page.getByTestId('ingest-tab-link').click();

    const submitBtn = page.getByRole('button', { name: '抓取' });
    await expect(submitBtn).toBeDisabled();

    await page.getByPlaceholder('https://...').fill('https://example.com');
    await expect(submitBtn).toBeEnabled();
  });

  test('text submit button is disabled when content is empty', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-ingest').click();

    const submitBtn = page.getByRole('button', { name: '入库' });
    await expect(submitBtn).toBeDisabled();

    await page.getByPlaceholder('输入文本内容...').fill('Some content');
    await expect(submitBtn).toBeEnabled();
  });
});
