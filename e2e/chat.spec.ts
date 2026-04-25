import { test, expect } from '@playwright/test';

test.describe('Chat', () => {
  test('can toggle ingest panel', async ({ page }) => {
    await page.goto('/');

    const toggle = page.getByText('添加知识');
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect(page.getByText('文本')).toBeVisible();
    await expect(page.getByText('链接')).toBeVisible();
    await expect(page.getByText('文件')).toBeVisible();
    await expect(page.getByText('RSS')).toBeVisible();
  });

  test('chat input is present and clickable', async ({ page }) => {
    await page.goto('/');

    const input = page.getByPlaceholder('问点什么...');
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();

    const sendBtn = page.locator('button[type="submit"]');
    await expect(sendBtn).toBeVisible();
  });
});
