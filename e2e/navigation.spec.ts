import { test, expect } from './fixtures';

test.describe('Navigation', () => {
  test('homepage loads with sidebar and chat panel', async ({ page }) => {
    await page.goto('/');

    // Sidebar visible
    await expect(page.getByRole('heading', { name: '知识库' })).toBeVisible();
    await expect(page.getByText('对话')).toBeVisible();
    await expect(page.getByText('收件箱')).toBeVisible();
    await expect(page.getByText('订阅')).toBeVisible();
    await expect(page.getByText('笔记')).toBeVisible();

    // Chat panel default visible
    await expect(page.getByText('知识库助手')).toBeVisible();
    await expect(page.getByPlaceholder('问点什么...')).toBeVisible();
  });

  test('switching tabs works', async ({ page }) => {
    await page.goto('/');

    // Switch to Inbox
    await page.getByText('收件箱').click();
    await expect(page.getByText('待审核')).toBeVisible();

    // Switch to RSS
    await page.getByText('订阅').click();
    await expect(page.getByText('RSS 订阅')).toBeVisible();

    // Switch to Notes
    await page.getByText('笔记').click();
    await expect(page.getByRole('heading', { name: '笔记' })).toBeVisible();

    // Back to Chat
    await page.getByText('对话').click();
    await expect(page.getByText('知识库助手')).toBeVisible();
  });
});
