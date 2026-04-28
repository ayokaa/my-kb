import { test, expect } from './fixtures';
import { resetTestData } from './fixtures';

test.describe.serial('Logs', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('panel loads with toolbar and filters', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-logs').click();

    await expect(page.getByText('运行日志')).toBeVisible();
    await expect(page.getByRole('button', { name: /^全部/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^调试/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^信息/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^警告/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^错误/ })).toBeVisible();
  });

  test('level filter buttons are clickable', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-logs').click();

    await page.getByRole('button', { name: /^调试/ }).click();
    await page.getByRole('button', { name: /^信息/ }).click();
    await page.getByRole('button', { name: /^警告/ }).click();
    await page.getByRole('button', { name: /^错误/ }).click();
    await page.getByRole('button', { name: /^全部/ }).click();
  });

  test('live toggle switches between live and paused', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-logs').click();

    await expect(page.getByText('实时')).toBeVisible();
    await page.getByText('实时').click();
    await expect(page.getByText('暂停')).toBeVisible();
  });
});
