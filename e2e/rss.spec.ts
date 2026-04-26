import { test, expect } from './fixtures';
import { resetTestData } from './fixtures';

test.describe.serial('RSS Subscriptions', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('RSS panel shows empty state', async ({ page }) => {
    await page.goto('/');
    await page.getByText('订阅').click();
    await page.waitForTimeout(500);

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
});
