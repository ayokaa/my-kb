import { test, expect } from './fixtures';
import { resetTestData } from './fixtures';

test.describe.serial('Inbox', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('shows empty state when no entries', async ({ page }) => {
    await page.goto('/');
    await page.getByText('收件箱').click();

    await expect(page.getByText('待审核')).toBeVisible();
    await expect(page.getByText('收件箱为空')).toBeVisible();
  });

  test('can view and archive an entry', async ({ page, request }) => {
    await request.post('/api/ingest', {
      data: { type: 'text', title: 'E2E Test Article', content: 'This is a test content for E2E.' },
    });
    await request.post('/api/ingest', {
      data: { type: 'text', title: 'Keep This One', content: 'This entry should remain.' },
    });

    await page.goto('/');
    await page.getByText('收件箱').click();

    await expect(page.getByText('E2E Test Article').first()).toBeVisible();

    await page.getByRole('button', { name: /E2E Test Article/ }).click();
    await expect(page.getByText('This is a test content for E2E.')).toBeVisible();

    await page.getByRole('button', { name: '忽略' }).click();

    await expect(page.getByText('E2E Test Article')).not.toBeVisible();
    await expect(page.getByText('已忽略')).toBeVisible();
  });

  test('can approve an entry to queue', async ({ page, request }) => {
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

    await page.getByRole('button', { name: '加入知识库' }).click();

    await expect(page.getByText('已加入处理队列')).toBeVisible();
    await expect(page.getByText('Approve Test')).not.toBeVisible();
  });

  test('inbox count badge updates', async ({ page, request }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    await request.post('/api/ingest', {
      data: { type: 'text', title: 'Badge Test', content: 'Testing badge count.' },
    });

    await page.getByText('收件箱').click();
    await expect(page.getByText('Badge Test').first()).toBeVisible();

    await page.getByRole('button', { name: '忽略' }).click();

    await expect(page.getByText('收件箱为空')).toBeVisible();
  });
});
