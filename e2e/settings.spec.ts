import { test, expect, resetTestData } from './fixtures';

test.describe.serial('Settings', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('can navigate to settings panel', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('panel-settings')).toBeVisible();
    await expect(page.getByText('系统设置')).toBeVisible();
    await expect(page.getByText('LLM 配置')).toBeVisible();
    await expect(page.getByText('定时任务')).toBeVisible();
    await expect(page.getByText('收件箱')).toBeVisible();
  });

  test('loads and displays default settings', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();

    const llmSection = page.locator('section').filter({ hasText: 'LLM 配置' });
    const cronSection = page.locator('section').filter({ hasText: '定时任务' });

    await expect(llmSection.locator('input[type="text"]').first()).toHaveValue('MiniMax-M2.7');
    // API key may be overridden by environment variable and masked on display
    const apiKeyValue = await llmSection.locator('input[type="password"]').first().inputValue();
    expect(apiKeyValue.length).toBeGreaterThan(0);
    await expect(llmSection.locator('input[type="text"]').nth(1)).toHaveValue('https://api.minimaxi.com/anthropic');

    await expect(cronSection.locator('input[type="number"]').first()).toHaveValue('60');
    await expect(cronSection.locator('input[type="text"]').first()).toHaveValue('0 3 * * *');
  });

  test('can modify settings and save successfully', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();

    const llmSection = page.locator('section').filter({ hasText: 'LLM 配置' });
    const cronSection = page.locator('section').filter({ hasText: '定时任务' });

    await llmSection.locator('input[type="text"]').first().fill('claude-3-opus');
    await llmSection.locator('input[type="password"]').first().fill('sk-test-secret-key');
    await llmSection.locator('input[type="text"]').nth(1).fill('https://api.example.com');

    await cronSection.locator('input[type="number"]').first().fill('30');
    await cronSection.locator('input[type="text"]').first().fill('0 */6 * * *');

    await page.getByRole('button', { name: '保存设置' }).click();

    await expect(page.locator('div').filter({ hasText: '配置已保存' }).first()).toBeVisible({ timeout: 5000 });

    // Verify persisted values after reload
    await page.reload();
    await page.getByTestId('nav-settings').click();

    await expect(llmSection.locator('input[type="text"]').first()).toHaveValue('claude-3-opus');
    // API key is overridden by environment variable on load, so skip exact check
    await expect(llmSection.locator('input[type="text"]').nth(1)).toHaveValue('https://api.example.com');

    await expect(cronSection.locator('input[type="number"]').first()).toHaveValue('30');
    await expect(cronSection.locator('input[type="text"]').first()).toHaveValue('0 */6 * * *');
  });

  test('shows error for invalid cron expression', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();

    const cronSection = page.locator('section').filter({ hasText: '定时任务' });
    await cronSection.locator('input[type="text"]').first().fill('invalid cron');

    await page.getByRole('button', { name: '保存设置' }).click();

    await expect(page.locator('div').filter({ hasText: /Invalid cron expression/ }).first()).toBeVisible({ timeout: 5000 });
  });

  test('shows error for invalid RSS interval', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();

    const cronSection = page.locator('section').filter({ hasText: '定时任务' });
    await cronSection.locator('input[type="number"]').first().fill('0');

    await page.getByRole('button', { name: '保存设置' }).click();

    await expect(page.locator('div').filter({ hasText: /RSS interval must be a positive number/ }).first()).toBeVisible({ timeout: 5000 });
  });

  test('shows autoDigest toggle in inbox section', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();

    const digestSection = page.locator('section').filter({ hasText: '收件箱' });
    await expect(digestSection.getByText('自动生成摘要')).toBeVisible();
    await expect(digestSection.getByText('RSS 条目写入收件箱后自动生成 AI 摘要')).toBeVisible();
  });

  test('autoDigest toggle is on by default', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();

    const digestSection = page.locator('section').filter({ hasText: '收件箱' });
    const toggle = digestSection.locator('button[type="button"]');
    // Default is on, so the toggle should have accent color (active state)
    await expect(toggle).toHaveClass(/bg-\[var\(--accent\)\]/);
  });

  test('can toggle autoDigest off and save', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();

    const digestSection = page.locator('section').filter({ hasText: '收件箱' });
    const toggle = digestSection.locator('button[type="button"]');

    // Click to turn off
    await toggle.click();

    // Save
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.locator('div').filter({ hasText: '配置已保存' }).first()).toBeVisible({ timeout: 5000 });

    // Reload and verify
    await page.reload();
    await page.getByTestId('nav-settings').click();

    const digestSectionAfterReload = page.locator('section').filter({ hasText: '收件箱' });
    const toggleAfterReload = digestSectionAfterReload.locator('button[type="button"]');
    // Should be off (not accent color)
    await expect(toggleAfterReload).not.toHaveClass(/bg-\[var\(--accent\)\]/);
  });
});
