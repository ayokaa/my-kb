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

test.describe.serial('Ingest', () => {
  test.beforeEach(async ({ request }) => {
    await clearInbox(request);
  });

  test('can ingest text via UI', async ({ page }) => {
    await page.goto('/');

    // Toggle ingest panel
    await page.getByText('添加知识').click();
    await expect(page.getByText('文本')).toBeVisible();

    // Fill text form
    await page.getByPlaceholder('标题（可选）').fill('UI Ingest Test');
    await page.getByPlaceholder('输入文本内容...').fill('Content added through the UI ingest form.');

    // Submit
    await page.getByRole('button', { name: '入库' }).click();

    // Go to inbox to verify
    await page.getByText('收件箱').click();
    await expect(page.getByText('UI Ingest Test').first()).toBeVisible();
  });

  test('ingest link form is present and submittable', async ({ page }) => {
    await page.goto('/');

    await page.getByText('添加知识').click();

    // Switch to link tab
    await page.getByText('链接').click();

    const linkInput = page.getByPlaceholder('https://...');
    await expect(linkInput).toBeVisible();
    await expect(linkInput).toBeEnabled();

    // Type a URL (don't actually submit to avoid slow web fetch in E2E)
    await linkInput.fill('https://example.com/article');

    const submitBtn = page.locator('button', { hasText: '抓取' });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeEnabled();
  });

  test('ingest tabs can be switched', async ({ page }) => {
    await page.goto('/');

    await page.getByText('添加知识').click();

    // Default should show text tab
    await expect(page.getByPlaceholder('输入文本内容...')).toBeVisible();

    // Switch to link
    await page.getByText('链接').click();
    await expect(page.getByPlaceholder('https://...')).toBeVisible();

    // Switch to file
    await page.getByText('文件').click();

    // Switch back to text
    await page.getByText('文本').click();
    await expect(page.getByPlaceholder('输入文本内容...')).toBeVisible();
  });

  test('RSS tab is present in ingest panel', async ({ page }) => {
    await page.goto('/');

    await page.getByText('添加知识').click();

    await expect(page.getByText('RSS')).toBeVisible();
  });
});
