import { test, expect } from './fixtures';
import { resetTestData, createTestNote } from './fixtures';

test.describe.serial('Search', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('can search notes by title', async ({ page }) => {
    await createTestNote({ id: 'search-alpha', title: 'Alpha Note', tags: ['alpha'], status: 'seed' });
    await createTestNote({ id: 'search-beta', title: 'Beta Note', tags: ['beta'], status: 'seed' });

    await page.goto('/');
    await page.getByText('笔记').click();

    await expect(page.getByRole('button', { name: /Alpha Note/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Beta Note/ })).toBeVisible();

    await page.getByPlaceholder('搜索笔记标题、标签…').fill('Alpha');

    await expect(page.getByRole('button', { name: /Alpha Note/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Beta Note/ })).not.toBeVisible();
  });

  test('can search notes by tag', async ({ page }) => {
    await createTestNote({ id: 'tag-search-a', title: 'Note A', tags: ['machine-learning'], status: 'seed' });
    await createTestNote({ id: 'tag-search-b', title: 'Note B', tags: ['cooking'], status: 'seed' });

    await page.goto('/');
    await page.getByText('笔记').click();

    await page.getByPlaceholder('搜索笔记标题、标签…').fill('machine-learning');

    await expect(page.getByRole('button', { name: /Note A/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Note B/ })).not.toBeVisible();
  });

  test('search with no matches shows empty state', async ({ page }) => {
    await createTestNote({ id: 'no-match', title: 'Existing Note', tags: [], status: 'seed' });

    await page.goto('/');
    await page.getByText('笔记').click();

    await page.getByPlaceholder('搜索笔记标题、标签…').fill('xyz-nonexistent');

    await expect(page.getByText('无匹配结果')).toBeVisible();
  });

  test('clearing search shows all notes', async ({ page }) => {
    await createTestNote({ id: 'clear-a', title: 'Clear A', tags: [], status: 'seed' });
    await createTestNote({ id: 'clear-b', title: 'Clear B', tags: [], status: 'seed' });

    await page.goto('/');
    await page.getByText('笔记').click();

    const searchInput = page.getByPlaceholder('搜索笔记标题、标签…');
    await searchInput.fill('Clear A');
    await expect(page.getByRole('button', { name: /Clear B/ })).not.toBeVisible();

    await searchInput.fill('');
    await expect(page.getByRole('button', { name: /Clear A/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Clear B/ })).toBeVisible();
  });

  test('search combined with status filter', async ({ page }) => {
    await createTestNote({ id: 'filter-seed', title: 'Seed Note', tags: [], status: 'seed' });
    await createTestNote({ id: 'filter-evergreen', title: 'Evergreen Note', tags: [], status: 'evergreen' });

    await page.goto('/');
    await page.getByText('笔记').click();

    // First filter by status
    await page.getByRole('button', { name: '常青', exact: true }).click();
    await expect(page.getByRole('button', { name: /Evergreen Note/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Seed Note/ })).not.toBeVisible();

    // Then search within filtered results
    await page.getByPlaceholder('搜索笔记标题、标签…').fill('Seed');
    await expect(page.getByText('无匹配结果')).toBeVisible();
  });
});
