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
    await page.getByTestId('nav-inbox').click();

    await expect(page.getByText('待审核')).toBeVisible();
    await expect(page.getByText('收件箱为空')).toBeVisible();
  });

  test('can view and archive an entry', async ({ page }) => {
    // Write inbox entries directly (manual ingest no longer goes through inbox)
    const root = join(process.cwd(), 'knowledge-test');
    await writeFile(
      join(root, 'inbox', '1777100000000-e2e-test-article.md'),
      `---\nsource_type: text\ntitle: E2E Test Article\nextracted_at: '${new Date().toISOString()}'\n---\n\nThis is a test content for E2E.\n`
    );
    await writeFile(
      join(root, 'inbox', '1777100000001-keep-this-one.md'),
      `---\nsource_type: text\ntitle: Keep This One\nextracted_at: '${new Date().toISOString()}'\n---\n\nThis entry should remain.\n`
    );

    await page.goto('/');
    await page.getByTestId('nav-inbox').click();

    await expect(page.getByText('E2E Test Article').first()).toBeVisible();

    await page.getByRole('button', { name: /E2E Test Article/ }).click();
    await expect(page.getByText('This is a test content for E2E.')).toBeVisible();

    await page.getByRole('button', { name: '忽略' }).click();

    await expect(page.getByText('E2E Test Article')).not.toBeVisible();
    await expect(page.getByText('已忽略')).toBeVisible();
  });

  test('can approve an entry to queue', async ({ page }) => {
    // Write inbox entries directly
    const root = join(process.cwd(), 'knowledge-test');
    await writeFile(
      join(root, 'inbox', '1777100000002-approve-test.md'),
      `---\nsource_type: text\ntitle: Approve Test\nextracted_at: '${new Date().toISOString()}'\n---\n\nContent to be approved.\n`
    );
    await writeFile(
      join(root, 'inbox', '1777100000003-remain-after-approve.md'),
      `---\nsource_type: text\ntitle: Remain After Approve\nextracted_at: '${new Date().toISOString()}'\n---\n\nThis stays.\n`
    );

    await page.goto('/');
    await page.getByTestId('nav-inbox').click();

    await expect(page.getByText('Approve Test').first()).toBeVisible();
    await page.getByRole('button', { name: /Approve Test/ }).click();

    await page.getByRole('button', { name: '加入知识库' }).click();

    await expect(page.getByText('已加入处理队列')).toBeVisible();
    await expect(page.getByText('Approve Test')).not.toBeVisible();
  });

  test('inbox count badge updates', async ({ page }) => {
    await page.goto('/');

    // Write inbox entry directly
    const root = join(process.cwd(), 'knowledge-test');
    await writeFile(
      join(root, 'inbox', '1777100000004-badge-test.md'),
      `---\nsource_type: text\ntitle: Badge Test\nextracted_at: '${new Date().toISOString()}'\n---\n\nTesting badge count.\n`
    );

    await page.getByTestId('nav-inbox').click();
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
    await page.getByTestId('nav-inbox').click();

    await expect(page.getByText('RSS E2E Test Article').first()).toBeVisible();
    await page.getByRole('button', { name: /RSS E2E Test Article/ }).click();

    // Should show RSS-specific UI elements
    await expect(page.getByText('打开原文阅读')).toBeVisible();
    await expect(page.getByText('Feed 摘要')).toBeVisible();
    await expect(page.getByText('点击「加入知识库」后，系统将自动爬取原文并生成结构化笔记。')).toBeVisible();
  });

  test('RSS entry with digest shows AI summary card', async ({ page }) => {
    const root = join(process.cwd(), 'knowledge-test');
    const fileName = `1777300000000-Digest-E2E.md`;
    const content = `---
source_type: web
title: Article With AI Digest
extracted_at: '${new Date().toISOString()}'
rss_source: Tech Blog
rss_link: https://example.com/digest-article
rss_pubDate: '${new Date().toISOString()}'
digest: '这篇文章介绍了 Rust 语言在系统编程中的应用，主要讨论了内存安全和并发性能的优化策略。'
digest_generated_at: '${new Date().toISOString()}'
---

Full article content here.
`;
    await writeFile(join(root, 'inbox', fileName), content);

    await page.goto('/');
    await page.getByTestId('nav-inbox').click();

    await expect(page.getByText('Article With AI Digest').first()).toBeVisible();
    await page.getByRole('button', { name: /Article With AI Digest/ }).click();

    // Should show AI digest card
    await expect(page.getByText('AI 摘要')).toBeVisible();
    await expect(page.getByText(/Rust 语言在系统编程中的应用/)).toBeVisible();
  });

  test('RSS entry without digest does not show AI summary card', async ({ page }) => {
    const root = join(process.cwd(), 'knowledge-test');
    const fileName = `1777300000001-No-Digest.md`;
    const content = `---
source_type: web
title: Article Without Digest
extracted_at: '${new Date().toISOString()}'
rss_source: Tech Blog
rss_link: https://example.com/no-digest-article
rss_pubDate: '${new Date().toISOString()}'
---

Article content without digest.
`;
    await writeFile(join(root, 'inbox', fileName), content);

    await page.goto('/');
    await page.getByTestId('nav-inbox').click();

    await expect(page.getByText('Article Without Digest').first()).toBeVisible();
    await page.getByRole('button', { name: /Article Without Digest/ }).click();

    // Should NOT show AI digest card
    await expect(page.getByText('AI 摘要')).not.toBeVisible();
  });
});
