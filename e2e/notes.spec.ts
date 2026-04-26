import { test, expect } from './fixtures';
import { resetTestData } from './fixtures';

test.describe.serial('Notes', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('shows empty state when no notes', async ({ page }) => {
    await page.goto('/');
    await page.getByText('笔记').click();

    await expect(page.getByRole('heading', { name: '笔记' })).toBeVisible();
    await expect(page.getByText('还没有笔记')).toBeVisible();
  });

  test('search input is present and interactive', async ({ page }) => {
    await page.goto('/');
    await page.getByText('笔记').click();

    const searchInput = page.getByPlaceholder('搜索笔记标题、标签…');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEnabled();

    await searchInput.fill('nonexistent');
    await expect(page.getByText('还没有笔记')).toBeVisible();
  });

  test('status filter buttons work', async ({ page }) => {
    await page.goto('/');
    await page.getByText('笔记').click();

    await expect(page.getByText('全部')).toBeVisible();
    await expect(page.getByText('种子')).toBeVisible();
    await expect(page.getByText('生长中')).toBeVisible();
    await expect(page.getByText('常青')).toBeVisible();
    await expect(page.getByText('陈旧')).toBeVisible();

    await page.getByText('种子').click();
    await page.getByText('生长中').click();
    await page.getByText('常青').click();
    await page.getByText('陈旧').click();
    await page.getByText('全部').click();
  });
});
