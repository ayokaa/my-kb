import { test, expect } from './fixtures';

test.describe('Navigation', () => {
  test('homepage loads with sidebar and chat panel', async ({ page }) => {
    await page.goto('/');

    // Sidebar visible
    await expect(page.getByRole('heading', { name: '知识库' })).toBeVisible();
    await expect(page.getByTestId('nav-chat')).toBeVisible();
    await expect(page.getByTestId('nav-inbox')).toBeVisible();
    await expect(page.getByTestId('nav-rss')).toBeVisible();
    await expect(page.getByTestId('nav-notes')).toBeVisible();

    // Chat panel default visible
    await expect(page.getByText('知识库助手')).toBeVisible();
    await expect(page.getByLabel('聊天输入')).toBeVisible();
  });

  test('switching tabs works', async ({ page }) => {
    await page.goto('/');

    // Switch to Inbox
    await page.getByTestId('nav-inbox').click();
    await expect(page.getByText('待审核')).toBeVisible();

    // Switch to RSS
    await page.getByTestId('nav-rss').click();
    await expect(page.getByText('RSS 订阅')).toBeVisible();

    // Switch to Notes
    await page.getByTestId('nav-notes').click();
    await expect(page.getByRole('heading', { name: '笔记' })).toBeVisible();

    // Back to Chat
    await page.getByTestId('nav-chat').click();
    await expect(page.getByText('知识库助手')).toBeVisible();
  });
});
