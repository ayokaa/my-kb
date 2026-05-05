import { test, expect } from '@playwright/test';

const NAV_OPTS = { timeout: 15000, waitUntil: 'domcontentloaded' } as const;

async function waitForApp(page: any) {
  await page.waitForSelector('[data-ready="true"]', { timeout: 15000 });
}

async function createConvAndWaitForTextarea(page: any) {
  await page.getByRole('button', { name: '新对话' }).first().click();
  // 乐观更新后 ChatSession 立即渲染（不等 POST），等 textarea 出现
  await page.waitForSelector('textarea[placeholder="问点什么..."]', { timeout: 10000 });
}

function waitForPost(page: any) {
  return page.waitForResponse(
    r => r.url().endsWith('/api/conversations') && r.request().method() === 'POST' && r.status() === 200,
    { timeout: 15000 }
  );
}

function waitForDelete(page: any) {
  return page.waitForResponse(
    r => r.url().includes('/api/conversations/') && r.request().method() === 'DELETE' && r.status() === 200,
    { timeout: 10000 }
  );
}

test.describe('Chat Panel', () => {
  test('displays chat panel on load', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);
    await expect(page.getByRole('button', { name: '新对话' }).first()).toBeVisible();
  });

  test('creates a new conversation', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);
    await createConvAndWaitForTextarea(page);
    await expect(page.locator('[class*="space-y-1"]').getByText('新对话').first()).toBeVisible();
  });

  test('creates multiple conversations', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);
    const btn = page.getByRole('button', { name: '新对话' }).first();
    const before = await page.locator('[class*="space-y-1"] > div').count();
    await btn.click();
    await page.waitForFunction(
      (cnt) => document.querySelectorAll('[class*="space-y-1"] > div').length > cnt,
      before, { timeout: 10000 }
    );
    await page.waitForTimeout(400); // 尊重 300ms 防抖
    await btn.click();
    await page.waitForFunction(
      (cnt) => document.querySelectorAll('[class*="space-y-1"] > div').length > cnt,
      before + 1, { timeout: 10000 }
    );
    expect(await page.locator('[class*="space-y-1"] > div').count()).toBeGreaterThanOrEqual(before + 2);
  });

  test('switches between conversations', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);
    const btn = page.getByRole('button', { name: '新对话' }).first();
    await btn.click();
    await page.waitForFunction(
      () => document.querySelectorAll('[class*="space-y-1"] > div').length >= 1,
      { timeout: 10000 }
    );
    await page.waitForTimeout(400);
    await btn.click();
    await page.waitForFunction(
      () => document.querySelectorAll('[class*="space-y-1"] > div').length >= 2,
      { timeout: 10000 }
    );
    const items = page.locator('[class*="space-y-1"] > div');
    await items.nth(0).locator('button').first().click();
    await expect(items.nth(0)).toHaveClass(/bg-\[var\(--accent-dim\)\]/);
  });

  test('deletes a conversation', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);
    await createConvAndWaitForTextarea(page);
    const before = await page.locator('[class*="space-y-1"] > div').count();
    expect(before).toBeGreaterThanOrEqual(1);

    const first = page.locator('[class*="space-y-1"] > div').first();
    await first.hover();
    await first.getByLabel('删除对话').click();
    await page.waitForTimeout(300);
    await first.hover();
    const confirm = first.getByLabel('确认删除');
    if (await confirm.isVisible().catch(() => false)) {
      const delDone = waitForDelete(page);
      await confirm.click();
      await delDone;
    }
    expect(await page.locator('[class*="space-y-1"] > div').count()).toBeLessThan(before);
  });

  test('textarea accepts input and send enables', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);
    await createConvAndWaitForTextarea(page);
    const input = page.getByPlaceholder('问点什么...');
    await input.fill('你好');
    await expect(input).toHaveValue('你好');
    await expect(page.getByRole('button', { name: '发送' })).toBeEnabled();
  });

  test('input area + button also creates conversation', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);
    // 第一个对话用侧边栏按钮
    const sidebarBtn = page.getByRole('button', { name: '新对话' }).first();
    await sidebarBtn.click();
    await page.waitForFunction(
      () => document.querySelectorAll('[class*="space-y-1"] > div').length >= 1,
      { timeout: 10000 }
    );
    await page.waitForTimeout(400);
    const before = await page.locator('[class*="space-y-1"] > div').count();
    await page.getByTitle('新对话').click();
    await page.waitForFunction(
      (cnt) => document.querySelectorAll('[class*="space-y-1"] > div').length > cnt,
      before, { timeout: 10000 }
    );
  });

  test('send button disabled with empty input', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);
    await createConvAndWaitForTextarea(page);
    await expect(page.getByRole('button', { name: '发送' })).toBeDisabled();
  });
});

test.describe('Theme', () => {
  test('toggles and persists across reload', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);
    const html = page.locator('html');
    const initial = await html.getAttribute('data-theme');
    await page.locator('button[title*="切换到"]').first().click();
    await expect(html).not.toHaveAttribute('data-theme', initial);
    await page.reload(); await waitForApp(page);
    await expect(html).not.toHaveAttribute('data-theme', initial);
  });

  test('theme is set immediately (no flash)', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    const theme = await page.locator('html').getAttribute('data-theme');
    expect(['dark', 'light']).toContain(theme);
  });
});

test.describe('Persistence', () => {
  test('conversations survive reload', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);
    const before = await page.locator('[class*="space-y-1"] > div').count();

    // 需要等 POST 确认持久化——用 waitForResponse
    const postDone = waitForPost(page);
    await page.getByRole('button', { name: '新对话' }).first().click();
    await postDone;

    const afterCreate = await page.locator('[class*="space-y-1"] > div').count();
    expect(afterCreate).toBeGreaterThan(before);
    await page.reload(); await waitForApp(page);
    expect(await page.locator('[class*="space-y-1"] > div').count()).toBeGreaterThanOrEqual(afterCreate);
  });

  test('deleted stays gone after reload', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);

    const postDone = waitForPost(page);
    await page.getByRole('button', { name: '新对话' }).first().click();
    await postDone;

    const before = await page.locator('[class*="space-y-1"] > div').count();
    const first = page.locator('[class*="space-y-1"] > div').first();
    await first.hover();
    await first.getByLabel('删除对话').click();
    await page.waitForTimeout(300);
    await first.hover();
    const confirm = first.getByLabel('确认删除');
    if (await confirm.isVisible().catch(() => false)) {
      const delDone = waitForDelete(page);
      await confirm.click();
      await delDone;
    }
    expect(await page.locator('[class*="space-y-1"] > div').count()).toBeLessThan(before);
    await page.reload(); await waitForApp(page);
    expect(await page.locator('[class*="space-y-1"] > div').count()).toBeLessThan(before);
  });
});

test.describe('Edge cases', () => {
  test('sidebar handles many conversations', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);
    const btn = page.getByRole('button', { name: '新对话' }).first();
    for (let i = 0; i < 5; i++) {
      await btn.click();
      await page.waitForFunction(
        (cnt) => document.querySelectorAll('[class*="space-y-1"] > div').length > cnt,
        i, { timeout: 10000 }
      );
      await page.waitForTimeout(400);
    }
    const items = page.locator('[class*="space-y-1"] > div');
    expect(await items.count()).toBeGreaterThanOrEqual(5);
    await expect(items.last()).toBeAttached();
  });

  test('ChatSession remounts when switching back', async ({ page }) => {
    await page.goto('/', NAV_OPTS);
    await waitForApp(page);
    const btn = page.getByRole('button', { name: '新对话' }).first();
    await btn.click();
    await page.waitForFunction(
      () => document.querySelectorAll('[class*="space-y-1"] > div').length >= 1,
      { timeout: 10000 }
    );
    await page.waitForTimeout(400);
    await btn.click();
    await page.waitForFunction(
      () => document.querySelectorAll('[class*="space-y-1"] > div').length >= 2,
      { timeout: 10000 }
    );
    const items = page.locator('[class*="space-y-1"] > div');
    await items.nth(0).locator('button').first().click();
    await page.waitForSelector('textarea[placeholder="问点什么..."]', { timeout: 5000 });
    await expect(page.getByPlaceholder('问点什么...')).toBeVisible();
  });
});
