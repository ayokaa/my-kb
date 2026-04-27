import { test, expect } from './fixtures';

test.describe('Chat', () => {
  test('can toggle ingest panel', async ({ page }) => {
    await page.goto('/');

    const nav = page.getByTestId('nav-ingest');
    await expect(nav).toBeVisible();

    await nav.click();
    await expect(page.getByTestId('ingest-tab-text')).toBeVisible();
    await expect(page.getByTestId('ingest-tab-link')).toBeVisible();
    await expect(page.getByTestId('ingest-tab-file')).toBeVisible();
    await expect(page.getByTestId('ingest-tab-rss')).toBeVisible();
  });

  test('chat input is present and clickable', async ({ page }) => {
    await page.goto('/');

    const input = page.getByLabel('聊天输入');
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();

    const sendBtn = page.getByRole('button', { name: '发送' });
    await expect(sendBtn).toBeVisible();
  });

  test('send button is disabled when input is empty', async ({ page }) => {
    await page.goto('/');

    const input = page.getByLabel('聊天输入');
    const sendBtn = page.getByRole('button', { name: '发送' });

    await expect(sendBtn).toBeDisabled();

    await input.fill('Hello');
    await expect(sendBtn).toBeEnabled();

    await input.fill('');
    await expect(sendBtn).toBeDisabled();
  });

  test('typing in input updates value', async ({ page }) => {
    await page.goto('/');

    const input = page.getByLabel('聊天输入');
    await input.fill('Test message');
    await expect(input).toHaveValue('Test message');
  });
});
