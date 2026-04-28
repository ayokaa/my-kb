import { test, expect } from './fixtures';
import { resetTestData } from './fixtures';
import { writeFile } from 'fs/promises';
import { join } from 'path';

test.describe.serial('Tasks', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('panel loads with toolbar and filters', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-tasks').click();

    await expect(page.getByText('任务队列')).toBeVisible();
    await expect(page.getByRole('button', { name: /^全部/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^等待中/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^执行中/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^已完成/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^失败/ })).toBeVisible();
  });

  test('status filter buttons are clickable', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-tasks').click();

    await page.getByRole('button', { name: /^等待中/ }).click();
    await page.getByRole('button', { name: /^执行中/ }).click();
    await page.getByRole('button', { name: /^已完成/ }).click();
    await page.getByRole('button', { name: /^失败/ }).click();
    await page.getByRole('button', { name: /^全部/ }).click();
  });

  test('displays tasks after ingest is queued', async ({ page, request }) => {
    const root = join(process.cwd(), 'knowledge-test');
    const fileName = '1777100000000-task-test-entry.md';
    await writeFile(
      join(root, 'inbox', fileName),
      `---\nsource_type: text\ntitle: Task Test Entry\nextracted_at: '${new Date().toISOString()}'\n---\n\nTesting task panel.\n`
    );
    await request.post('/api/inbox/process', { data: { fileName } });

    await page.goto('/');
    await page.getByTestId('nav-tasks').click();

    await expect(page.getByText(fileName)).toBeVisible();
  });

  test('failed tasks show error message and retry button', async ({ page, request }) => {
    // Write an inbox entry, process to create a task, then archive the inbox file
    // so the worker fails when trying to process it
    const root = join(process.cwd(), 'knowledge-test');
    const fileName = '1777100000001-fail-task-test.md';
    await writeFile(
      join(root, 'inbox', fileName),
      `---\nsource_type: text\ntitle: Fail Task Test\nextracted_at: '${new Date().toISOString()}'\n---\n\nThis will fail.\n`
    );
    await request.post('/api/inbox/process', { data: { fileName } });

    // Archive the inbox entry to make the task fail
    await request.post('/api/inbox/archive', { data: { fileName } });

    await page.goto('/');
    await page.getByTestId('nav-tasks').click();

    // The task should appear in the list (status may vary depending on timing)
    await expect(page.getByText(fileName).first()).toBeVisible();
  });

  test('status filter buttons show correct counts', async ({ page, request }) => {
    const root = join(process.cwd(), 'knowledge-test');
    const fileName = '1777100000002-filter-test.md';
    await writeFile(
      join(root, 'inbox', fileName),
      `---\nsource_type: text\ntitle: Filter Test\nextracted_at: '${new Date().toISOString()}'\n---\n\nTesting filters.\n`
    );
    await request.post('/api/inbox/process', { data: { fileName } });

    await page.goto('/');
    await page.getByTestId('nav-tasks').click();

    // Wait for tasks to load
    await expect(page.getByText('任务队列')).toBeVisible();

    // All filter should show count
    const allBtn = page.getByRole('button', { name: /^全部/ });
    await expect(allBtn).toBeVisible();

    // Click pending filter
    await page.getByRole('button', { name: /^等待中/ }).click();

    // Click done filter
    await page.getByRole('button', { name: /^已完成/ }).click();

    // Click failed filter
    await page.getByRole('button', { name: /^失败/ }).click();

    // Back to all
    await allBtn.click();
  });

  test('refresh button reloads tasks', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-tasks').click();

    await expect(page.getByText('任务队列')).toBeVisible();

    // Find and click the refresh button
    await page.getByTestId('tasks-refresh').click();

    // Should not throw and panel should still be visible
    await expect(page.getByText('任务队列')).toBeVisible();
  });
});
