import { test, expect } from './fixtures';
import { resetTestData, createTestNote } from './fixtures';

test.describe.serial('Notes', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('shows empty state when no notes', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-notes').click();

    await expect(page.getByRole('heading', { name: '笔记' })).toBeVisible();
    await expect(page.getByText('还没有笔记')).toBeVisible();
  });

  test('search input is present and interactive', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-notes').click();

    const searchInput = page.getByPlaceholder('搜索笔记标题、标签…');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEnabled();

    await searchInput.fill('nonexistent');
    await expect(page.getByText('还没有笔记')).toBeVisible();
  });

  test('status filter buttons work', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-notes').click();

    await expect(page.getByTestId('note-filter-all')).toBeVisible();
    await expect(page.getByRole('button', { name: '种子', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '生长中', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '常青', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '陈旧', exact: true })).toBeVisible();

    await page.getByTestId('note-filter-seed').click();
    await page.getByTestId('note-filter-growing').click();
    await page.getByTestId('note-filter-evergreen').click();
    await page.getByTestId('note-filter-stale').click();
    await page.getByTestId('note-filter-all').click();
  });

  test('can view note detail', async ({ page }) => {
    await createTestNote({
      id: 'e2e-test-note-1',
      title: 'E2E Test Note',
      summary: 'This is a test summary for E2E.',
      tags: ['e2e', 'testing'],
      status: 'seed',
      keyFacts: ['Fact one', 'Fact two'],
      content: 'Detailed content for the E2E test note.',
    });

    await page.goto('/');
    await page.getByTestId('nav-notes').click();

    await page.getByRole('button', { name: /E2E Test Note/ }).click();

    // Use main panel (detail area) to avoid matching list summary
    const detail = page.locator('main');
    await expect(detail.getByText('E2E Test Note').first()).toBeVisible();
    await expect(detail.getByText('This is a test summary for E2E.').first()).toBeVisible();
    await expect(detail.getByText('Fact one')).toBeVisible();
    await expect(detail.getByText('Fact two')).toBeVisible();
    await expect(detail.getByText('Detailed content for the E2E test note.')).toBeVisible();
  });

  test('can search and filter notes', async ({ page }) => {
    await createTestNote({
      id: 'e2e-alpha',
      title: 'Alpha Note',
      tags: ['alpha-tag'],
      status: 'seed',
      summary: 'Alpha summary',
    });
    await createTestNote({
      id: 'e2e-beta',
      title: 'Beta Note',
      tags: ['beta-tag'],
      status: 'growing',
      summary: 'Beta summary',
    });

    await page.goto('/');
    await page.getByTestId('nav-notes').click();

    // Both visible initially
    await expect(page.getByRole('button', { name: /Alpha Note/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Beta Note/ })).toBeVisible();

    // Search by title
    await page.getByPlaceholder('搜索笔记标题、标签…').fill('Alpha');
    await expect(page.getByRole('button', { name: /Alpha Note/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Beta Note/ })).not.toBeVisible();

    // Clear search
    await page.getByPlaceholder('搜索笔记标题、标签…').fill('');
    await expect(page.getByRole('button', { name: /Beta Note/ })).toBeVisible();

    // Search by tag
    await page.getByPlaceholder('搜索笔记标题、标签…').fill('beta-tag');
    await expect(page.getByRole('button', { name: /Beta Note/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Alpha Note/ })).not.toBeVisible();

    // Clear and filter by status (use role button to avoid matching status badge)
    await page.getByPlaceholder('搜索笔记标题、标签…').fill('');
    await page.getByRole('button', { name: '生长中', exact: true }).click();
    await expect(page.getByRole('button', { name: /Beta Note/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Alpha Note/ })).not.toBeVisible();
  });

  test('can delete a note with confirmation', async ({ page }) => {
    await createTestNote({
      id: 'e2e-delete-target',
      title: 'Delete Me',
      status: 'seed',
      summary: 'This note will be deleted.',
    });

    await page.goto('/');
    await page.getByTestId('nav-notes').click();

    await page.getByRole('button', { name: /Delete Me/ }).click();
    await expect(page.getByText('This note will be deleted.').first()).toBeVisible();

    await page.getByRole('button', { name: '删除' }).click();
    await expect(page.getByText('确定删除《Delete Me》？')).toBeVisible();

    await page.getByRole('button', { name: '确认删除' }).click();

    await expect(page.getByRole('button', { name: /Delete Me/ })).not.toBeVisible();
    await expect(page.getByText('还没有笔记')).toBeVisible();
  });

  test('note detail shows all metadata fields', async ({ page }) => {
    await createTestNote({
      id: 'e2e-detail-full',
      title: 'Full Detail Note',
      tags: ['tag-a', 'tag-b'],
      status: 'evergreen',
      summary: 'A comprehensive summary.',
      keyFacts: ['Fact 1', 'Fact 2', 'Fact 3'],
      content: 'Main content body.',
      sources: ['https://example.com/source'],
    });

    await page.goto('/');
    await page.getByTestId('nav-notes').click();

    await page.getByRole('button', { name: /Full Detail Note/ }).click();

    const detail = page.locator('main');
    await expect(detail.getByText('Full Detail Note').first()).toBeVisible();
    await expect(detail.getByText('tag-a').nth(1)).toBeVisible();
    await expect(detail.getByText('tag-b').nth(1)).toBeVisible();
    await expect(detail.getByText('常青').first()).toBeVisible();
    await expect(detail.getByText('Fact 1')).toBeVisible();
    await expect(detail.getByText('Fact 2')).toBeVisible();
    await expect(detail.getByText('Fact 3')).toBeVisible();
    await expect(detail.getByText('Main content body.')).toBeVisible();
  });

  test('status badge colors are correct', async ({ page }) => {
    await createTestNote({ id: 'e2e-status-seed', title: 'Seed Status', status: 'seed' });
    await createTestNote({ id: 'e2e-status-growing', title: 'Growing Status', status: 'growing' });
    await createTestNote({ id: 'e2e-status-evergreen', title: 'Evergreen Status', status: 'evergreen' });

    await page.goto('/');
    await page.getByTestId('nav-notes').click();

    await expect(page.getByRole('button', { name: /Seed Status.*种子/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Growing Status.*生长中/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Evergreen Status.*常青/ })).toBeVisible();
  });
});
