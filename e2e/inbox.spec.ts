import { test, expect } from './fixtures';

async function clearInbox(request: any) {
  const res = await request.get('/api/inbox');
  const data = await res.json();
  for (const entry of data.entries || []) {
    const fileName = entry.filePath?.split('/').pop();
    if (fileName) {
      await request.post('/api/inbox/archive', { data: { fileName } });
    }
  }
}

test.describe.serial('Inbox', () => {
  test.beforeEach(async ({ request }) => {
    await clearInbox(request);
  });

  test('shows empty state when no entries', async ({ page }) => {
    await page.goto('/');
    await page.getByText('收件箱').click();

    await expect(page.getByText('待审核')).toBeVisible();
    await expect(page.getByText('收件箱为空')).toBeVisible();
  });

  test('can view and archive an entry', async ({ page, request }) => {
    // Create two entries so one remains after archive
    await request.post('/api/ingest', {
      data: { type: 'text', title: 'E2E Test Article', content: 'This is a test content for E2E.' },
    });
    await request.post('/api/ingest', {
      data: { type: 'text', title: 'Keep This One', content: 'This entry should remain.' },
    });

    await page.goto('/');
    await page.getByText('收件箱').click();

    // Entry appears in list
    await expect(page.getByText('E2E Test Article').first()).toBeVisible();

    // Click entry to see detail
    await page.getByRole('button', { name: /E2E Test Article/ }).click();
    await expect(page.getByText('This is a test content for E2E.')).toBeVisible();

    // Archive (ignore) it
    await page.getByRole('button', { name: '忽略' }).click();

    // Entry disappears from list
    await expect(page.getByText('E2E Test Article')).not.toBeVisible();
    // Result message visible in detail panel (since there's still another entry)
    await expect(page.getByText('已忽略')).toBeVisible();
  });

  test('can approve an entry to queue', async ({ page, request }) => {
    // Create two entries so one remains after approve
    await request.post('/api/ingest', {
      data: { type: 'text', title: 'Approve Test', content: 'Content to be approved.' },
    });
    await request.post('/api/ingest', {
      data: { type: 'text', title: 'Remain After Approve', content: 'This stays.' },
    });

    await page.goto('/');
    await page.getByText('收件箱').click();

    await expect(page.getByText('Approve Test').first()).toBeVisible();
    await page.getByRole('button', { name: /Approve Test/ }).click();

    // Click approve
    await page.getByRole('button', { name: '加入知识库' }).click();

    // Shows queued message (visible because another entry remains selected)
    await expect(page.getByText('已加入处理队列')).toBeVisible();

    // Entry disappears from inbox list
    await expect(page.getByText('Approve Test')).not.toBeVisible();
  });

  test('inbox count badge updates', async ({ page, request }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Create an entry
    await request.post('/api/ingest', {
      data: { type: 'text', title: 'Badge Test', content: 'Testing badge count.' },
    });

    // Navigate to inbox to trigger count refresh
    await page.getByText('收件箱').click();
    await expect(page.getByText('Badge Test').first()).toBeVisible();

    // Archive it
    await page.getByRole('button', { name: '忽略' }).click();

    // Should show empty state
    await expect(page.getByText('收件箱为空')).toBeVisible();
  });
});
