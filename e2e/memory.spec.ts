import { test, expect, resetTestData, createTestMemory } from './fixtures';

test.describe.serial('Memory', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('shows empty state when no memory exists', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-memory').click();

    await expect(page.getByText('AI 记忆')).toBeVisible();
    await expect(page.getByText('还没有积累任何记忆')).toBeVisible();
  });

  test('displays user profile when memory has data', async ({ page }) => {
    await createTestMemory({
      profile: { role: '开发者', interests: ['React', 'AI'], background: '前端背景' },
      noteKnowledge: {},
      conversationDigest: '',
      recentDigests: [],
      preferences: {},
      updatedAt: new Date().toISOString(),
    });

    await page.goto('/');
    await page.getByTestId('nav-memory').click();

    await expect(page.getByText('用户档案')).toBeVisible();
    await expect(page.getByText('开发者')).toBeVisible();
    await expect(page.getByText('React', { exact: true })).toBeVisible();
    await expect(page.getByText('AI', { exact: true })).toBeVisible();
    await expect(page.getByText('前端背景')).toBeVisible();
  });

  test('displays preferences and conversation digest', async ({ page }) => {
    await createTestMemory({
      profile: { interests: [] },
      noteKnowledge: {},
      conversationDigest: '最近在研究 React 19',
      recentDigests: [],
      preferences: { detailLevel: 'concise', language: 'zh' },
      updatedAt: new Date().toISOString(),
    });

    await page.goto('/');
    await page.getByTestId('nav-memory').click();

    await expect(page.getByText('偏好设置')).toBeVisible();
    await expect(page.getByText('detailLevel')).toBeVisible();
    await expect(page.getByText('concise')).toBeVisible();

    await expect(page.getByText('最近讨论')).toBeVisible();
    await expect(page.getByText('最近在研究 React 19')).toBeVisible();
  });

  test('can edit profile fields', async ({ page }) => {
    await createTestMemory({
      profile: { role: '旧角色', interests: ['旧兴趣'], background: '旧背景' },
      noteKnowledge: {},
      conversationDigest: '',
      recentDigests: [],
      preferences: {},
      updatedAt: new Date().toISOString(),
    });

    await page.goto('/');
    await page.getByTestId('nav-memory').click();

    // Click edit button
    await page.getByRole('button', { name: '编辑' }).click();

    // Edit role
    const roleInput = page.locator('label:has-text("角色") + input, label:has-text("角色") ~ input').first();
    await roleInput.fill('新角色');

    // Edit background
    const bgInput = page.locator('label:has-text("背景") + textarea, label:has-text("背景") ~ textarea').first();
    await bgInput.fill('新背景');

    // Save
    await page.getByRole('button', { name: '保存' }).click();

    // Verify updated values
    await expect(page.getByText('新角色')).toBeVisible();
    await expect(page.getByText('新背景')).toBeVisible();

    // Reload and verify persistence
    await page.reload();
    await page.getByTestId('nav-memory').click();
    await expect(page.getByText('新角色')).toBeVisible();
    await expect(page.getByText('新背景')).toBeVisible();
  });

  test('can delete conversation digest', async ({ page }) => {
    await createTestMemory({
      profile: { interests: [] },
      noteKnowledge: {},
      conversationDigest: '测试摘要内容',
      recentDigests: [],
      preferences: {},
      updatedAt: new Date().toISOString(),
    });

    await page.goto('/');
    await page.getByTestId('nav-memory').click();

    await expect(page.getByText('最近讨论')).toBeVisible();
    await expect(page.getByText('测试摘要内容')).toBeVisible();

    // Click delete button in digest section (title="删除" within the digest section)
    const digestSection = page.locator('section').filter({ hasText: '最近讨论' });
    await digestSection.locator('button[title="删除"]').click();

    // After deletion, digest section should disappear
    await expect(page.getByText('最近讨论')).not.toBeVisible();
  });

  test('can clear all memory', async ({ page }) => {
    await createTestMemory({
      profile: { role: '开发者', interests: ['React'] },
      noteKnowledge: { 'test-note': { level: 'discussed', firstSeenAt: new Date().toISOString(), lastReferencedAt: new Date().toISOString(), notes: '测试' } },
      conversationDigest: '测试摘要',
      recentDigests: [],
      preferences: { theme: 'dark' },
      updatedAt: new Date().toISOString(),
    });

    await page.goto('/');
    await page.getByTestId('nav-memory').click();

    await expect(page.getByText('用户档案')).toBeVisible();
    await expect(page.getByText('偏好设置')).toBeVisible();
    await expect(page.getByText('最近讨论')).toBeVisible();

    // Click clear-all button (Trash2 icon in toolbar)
    await page.locator('button[title="一键清除"]').click();

    // Confirm modal should appear
    await expect(page.getByText('确认清空全部记忆？')).toBeVisible();
    await page.getByRole('button', { name: '确认清空' }).click();

    // After clearing, empty state should appear
    await expect(page.getByText('还没有积累任何记忆')).toBeVisible();

    // Reload and verify still empty
    await page.reload();
    await page.getByTestId('nav-memory').click();
    await expect(page.getByText('还没有积累任何记忆')).toBeVisible();
  });
});
