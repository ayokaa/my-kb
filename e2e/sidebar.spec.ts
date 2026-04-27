import { test, expect } from './fixtures';
import { resetTestData } from './fixtures';

test.describe.serial('Sidebar', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('shows inbox badge when entries exist', async ({ page, request }) => {
    await page.goto('/');

    // Initially no badge
    await expect(page.getByTestId('nav-inbox').locator('..').getByText('1')).not.toBeVisible();

    // Add an inbox entry
    await request.post('/api/ingest', {
      data: { type: 'text', title: 'Badge Test', content: 'Testing badge.' },
    });

    // Reload to get updated badge count
    await page.reload();

    const inboxBtn = page.locator('button', { hasText: '收件箱' });
    await expect(inboxBtn.locator('span').filter({ hasText: '1' })).toBeVisible();
  });

  test('shows task badge when tasks exist', async ({ page, request }) => {
    await page.goto('/');

    // Add and process an entry to create a task
    await request.post('/api/ingest', {
      data: { type: 'text', title: 'Task Badge Test', content: 'Testing task badge.' },
    });

    const inboxRes = await request.get('/api/inbox');
    const inboxData = await inboxRes.json();
    const fileName = inboxData.entries[0]?.filePath?.split('/').pop();
    await request.post('/api/inbox/process', { data: { fileName } });

    await page.reload();

    const tasksBtn = page.locator('button', { hasText: '任务' });
    await expect(tasksBtn.locator('span').filter({ hasText: /^[1-9]\d*$/ })).toBeVisible();
  });

  test('active tab is visually highlighted', async ({ page }) => {
    await page.goto('/');

    // Default active tab is chat
    const chatBtn = page.getByTestId('nav-chat');
    await expect(chatBtn).toHaveClass(/bg-\[var\(--accent-dim\)\]/);

    // Switch to notes
    await page.getByTestId('nav-notes').click();
    const notesBtn = page.locator('button', { hasText: '笔记' });
    await expect(notesBtn).toHaveClass(/bg-\[var\(--accent-dim\)\]/);
    await expect(chatBtn).not.toHaveClass(/bg-\[var\(--accent-dim\)\]/);
  });

  test('all navigation items are visible', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('nav-chat')).toBeVisible();
    await expect(page.getByTestId('nav-inbox')).toBeVisible();
    await expect(page.getByTestId('nav-tasks')).toBeVisible();
    await expect(page.getByTestId('nav-rss')).toBeVisible();
    await expect(page.getByTestId('nav-notes')).toBeVisible();
  });
});
