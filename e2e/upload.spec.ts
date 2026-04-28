import { test, expect } from './fixtures';
import { resetTestData } from './fixtures';
import { writeFile } from 'fs/promises';
import { join } from 'path';

test.describe.serial('Upload', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('can upload a markdown file via UI', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-ingest').click();
    await page.getByTestId('ingest-tab-file').click();

    const fileInput = page.getByLabel('上传文件');
    const tmpFile = join(process.cwd(), 'knowledge-test', 'attachments', 'e2e-test-upload.md');
    await writeFile(tmpFile, '# Test Upload\n\nThis is a test markdown file for E2E upload.');

    await fileInput.setInputFiles(tmpFile);

    await expect(page.getByText('已入库')).toBeVisible({ timeout: 5000 });
  });

  test('can upload a plain text file via UI', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-ingest').click();
    await page.getByTestId('ingest-tab-file').click();

    const fileInput = page.getByLabel('上传文件');
    const tmpFile = join(process.cwd(), 'knowledge-test', 'attachments', 'e2e-test-upload.txt');
    await writeFile(tmpFile, 'Plain text content for E2E testing.');

    await fileInput.setInputFiles(tmpFile);

    await expect(page.getByText('已入库')).toBeVisible({ timeout: 5000 });
  });

  test('file input has correct accept attribute', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-ingest').click();
    await page.getByTestId('ingest-tab-file').click();

    const fileInput = page.getByLabel('上传文件');
    await expect(fileInput).toHaveAttribute('accept', '.pdf,.md,.txt,.markdown,application/pdf,text/plain,text/markdown');
  });

  test('shows supported file types hint', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-ingest').click();
    await page.getByTestId('ingest-tab-file').click();

    await expect(page.getByText('支持 PDF、Markdown、TXT')).toBeVisible();
  });
});
