import { test, expect } from './fixtures';
import { resetTestData } from './fixtures';
import { writeFile } from 'fs/promises';
import { join } from 'path';

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

    await request.post('/api/ingest', {
      data: { type: 'text', title: 'Badge Test', content: 'Testing badge count.' },
    });

    await page.getByText('收件箱').click();
    await expect(page.getByText('Badge Test').first()).toBeVisible();

    await page.getByRole('button', { name: '忽略' }).click();

    await expect(page.getByText('收件箱为空')).toBeVisible();
  });

  test('RSS entry shows open original link and feed summary', async ({ page }) => {
    // Write an RSS-type inbox entry directly (match writeInbox frontmatter format)
    const root = join(process.cwd(), 'knowledge-test');
    const fileName = `1777200000000-RSS-E2E-Test.md`;
    const content = `---
source_type: web
title: RSS E2E Test Article
extracted_at: '${new Date().toISOString()}'
rss_source: Test Blog
rss_link: https://example.com/rss-article
rss_pubDate: '${new Date().toISOString()}'
---

# RSS E2E Test Article

This is the RSS content for E2E testing.
`;
    await writeFile(join(root, 'inbox', fileName), content);

    await page.goto('/');
    await page.getByText('收件箱').click();

    await expect(page.getByText('RSS E2E Test Article').first()).toBeVisible();
    await page.getByRole('button', { name: /RSS E2E Test Article/ }).click();

    // Should show RSS-specific UI elements
    await expect(page.getByText('打开原文阅读')).toBeVisible();
    await expect(page.getByText('Feed 摘要')).toBeVisible();
    await expect(page.getByText('点击「加入知识库」后，系统将自动爬取原文并生成结构化笔记。')).toBeVisible();
  });
});
