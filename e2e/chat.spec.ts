import { test, expect } from './fixtures';

test.describe('Chat', () => {
  test('can toggle ingest panel', async ({ page }) => {
    await page.goto('/');

    const nav = page.getByTestId('nav-ingest');
    await expect(nav).toBeVisible();

    await nav.click();
    await expect(page.getByTestId('ingest-tab-text')).toBeVisible();
    await expect(page.getByTestId('ingest-tab-link')).toBeVisible();
    await expect(page.getByTestId('ingest-tab-file')).toBeVisible();
  });

  test('chat textarea is present and clickable', async ({ page }) => {
    await page.goto('/');

    const textarea = page.getByLabel('聊天输入');
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeEnabled();
    await expect(textarea).toHaveAttribute('rows', '1');

    const sendBtn = page.getByRole('button', { name: '发送' });
    await expect(sendBtn).toBeVisible();
  });

  test('send button is disabled when input is empty', async ({ page }) => {
    await page.goto('/');

    const textarea = page.getByLabel('聊天输入');
    const sendBtn = page.getByRole('button', { name: '发送' });

    await expect(sendBtn).toBeDisabled();

    await textarea.fill('Hello');
    await expect(sendBtn).toBeEnabled();

    await textarea.fill('');
    await expect(sendBtn).toBeDisabled();
  });

  test('typing in textarea updates value', async ({ page }) => {
    await page.goto('/');

    const textarea = page.getByLabel('聊天输入');
    await textarea.fill('Test message');
    await expect(textarea).toHaveValue('Test message');
  });

  test('Enter inserts newline in textarea', async ({ page }) => {
    await page.goto('/');

    const textarea = page.getByLabel('聊天输入');
    await textarea.fill('Line1');
    await textarea.press('End');
    await textarea.press('Enter');
    await textarea.type('Line2');
    await expect(textarea).toHaveValue('Line1\nLine2');
  });

  test('Ctrl+Enter submits chat message', async ({ page }) => {
    await page.goto('/');

    // Intercept chat API to avoid real LLM call
    let requestBody: unknown = null;
    await page.route('/api/chat', async (route, request) => {
      requestBody = request.postDataJSON();
      // Return a minimal valid ai SDK v3 stream response
      const body = '0:"Hello"\nd:{"finishReason":"stop"}\n';
      await route.fulfill({
        status: 200,
        body,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    });

    const textarea = page.getByLabel('聊天输入');
    await textarea.fill('Hello via Ctrl+Enter');
    await textarea.press('Control+Enter');

    await expect.poll(() => requestBody).toBeTruthy();
    const body = requestBody as { messages?: Array<{ role: string; content: string }> };
    const lastMessage = body.messages?.at(-1);
    expect(lastMessage?.content).toBe('Hello via Ctrl+Enter');
  });
});
