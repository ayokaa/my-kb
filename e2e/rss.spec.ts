import { test, expect } from './fixtures';

test.describe.serial('RSS Subscriptions', () => {
  test.beforeEach(async ({ request }) => {
    // Clear all subscriptions before each test
    const res = await request.get('/api/rss/subscriptions');
    const data = await res.json();
    for (const sub of data.subscriptions || []) {
      await request.delete('/api/rss/subscriptions', { data: { url: sub.url } });
    }
  });

  test('RSS panel shows empty state', async ({ page }) => {
    await page.goto('/');
    await page.getByText('订阅').click();

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

    // Should show the new subscription
    await expect(page.getByText('Overreacted', { exact: true })).toBeVisible();
    await expect(page.getByText('https://overreacted.io/rss.xml', { exact: true })).toBeVisible();
  });
});
