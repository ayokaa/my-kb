import { test, expect } from './fixtures';

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

  test('send button is disabled when input is empty', async ({ page }) => {
    await page.goto('/');

    const input = page.getByPlaceholder('问点什么...');
    const sendBtn = page.locator('button[type="submit"]');

    await expect(sendBtn).toBeDisabled();

    await input.fill('Hello');
    await expect(sendBtn).toBeEnabled();

    await input.fill('');
    await expect(sendBtn).toBeDisabled();
  });

  test('typing in input updates value', async ({ page }) => {
    await page.goto('/');

    const input = page.getByPlaceholder('问点什么...');
    await input.fill('Test message');
    await expect(input).toHaveValue('Test message');
  });
});
