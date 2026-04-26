import { test, expect } from './fixtures';

test.describe.serial('Tasks', () => {
  test('panel loads with toolbar and filters', async ({ page }) => {
    await page.goto('/');
    await page.getByText('任务').click();

    await expect(page.getByText('任务队列')).toBeVisible();
    await expect(page.getByRole('button', { name: /^全部/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^等待中/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^执行中/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^已完成/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^失败/ })).toBeVisible();
  });

  test('status filter buttons are clickable', async ({ page }) => {
    await page.goto('/');
    await page.getByText('任务').click();

    // Click through filters
    await page.getByRole('button', { name: /^等待中/ }).click();
    await page.getByRole('button', { name: /^执行中/ }).click();
    await page.getByRole('button', { name: /^已完成/ }).click();
    await page.getByRole('button', { name: /^失败/ }).click();
    await page.getByRole('button', { name: /^全部/ }).click();
  });

  test('displays tasks after ingest is queued', async ({ page, request }) => {
    // First clear any existing inbox
    const inboxRes = await request.get('/api/inbox');
    const inboxData = await inboxRes.json();
    for (const entry of inboxData.entries || []) {
      const fileName = entry.filePath?.split('/').pop();
      if (fileName) {
        await request.post('/api/inbox/archive', { data: { fileName } });
      }
    }

    // Create an inbox entry
    await request.post('/api/ingest', {
      data: { type: 'text', title: 'Task Test Entry', content: 'Testing task panel.' },
    });

    // Get the fileName
    const newInboxRes = await request.get('/api/inbox');
    const newInboxData = await newInboxRes.json();
    const fileName = newInboxData.entries[0]?.filePath?.split('/').pop();

    // Queue it for processing
    await request.post('/api/inbox/process', { data: { fileName } });

    await page.goto('/');
    await page.getByText('任务').click();

    // Should see the ingest task (use first() in case there are historical tasks)
    await expect(page.getByText(fileName)).toBeVisible();
  });
});
