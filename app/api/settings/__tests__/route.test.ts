import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpDir = mkdtempSync(join(tmpdir(), 'kb-settings-api-test-'));
process.env.KNOWLEDGE_ROOT = tmpDir;

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { GET, POST } from '../route';

vi.mock('@/lib/rss/cron', () => ({
  restartRSSCron: vi.fn(),
}));

vi.mock('@/lib/relink/cron', () => ({
  restartRelinkCron: vi.fn(),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  delete process.env.MINIMAX_API_KEY;
  delete process.env.LLM_MODEL;
  delete process.env.MINIMAX_BASE_URL;
  delete process.env.RSS_CHECK_INTERVAL_MINUTES;
  delete process.env.RELINK_CRON_EXPRESSION;
  // Clean up any persisted settings file
  try {
    const fs = await import('fs/promises');
    await fs.unlink(join(tmpDir, 'meta', 'settings.yml'));
  } catch {
    // File may not exist
  }
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('/api/settings', () => {
  it('GET returns default settings with masked apiKey', async () => {
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.llm.model).toBe('MiniMax-M2.7');
    expect(data.llm.apiKey).toBe('');
    expect(data.cron.rssIntervalMinutes).toBe(60);
  });

  it('POST persists settings and returns success', async () => {
    const body = {
      llm: { model: 'gpt-4', apiKey: 'sk-testkey1234567890', baseUrl: 'https://api.openai.com/v1' },
      cron: { rssIntervalMinutes: 30, relinkCronExpression: '0 0 * * *' },
    };

    const req = new Request('http://localhost/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify persistence via GET
    const getRes = await GET();
    const getData = await getRes.json();
    expect(getData.llm.model).toBe('gpt-4');
    expect(getData.llm.apiKey).toBe('sk-...7890');
  });

  it('POST rejects invalid cron expression', async () => {
    const body = {
      llm: { model: 'gpt-4', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      cron: { rssIntervalMinutes: 30, relinkCronExpression: 'invalid' },
    };

    const req = new Request('http://localhost/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Invalid cron expression');
  });

  it('POST rejects invalid RSS interval', async () => {
    const body = {
      llm: { model: 'gpt-4', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      cron: { rssIntervalMinutes: 0, relinkCronExpression: '0 3 * * *' },
    };

    const req = new Request('http://localhost/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('RSS interval');
  });

  it('POST triggers cron restart when intervals change', async () => {
    const { restartRSSCron } = await import('@/lib/rss/cron');
    const { restartRelinkCron } = await import('@/lib/relink/cron');

    // Save initial settings
    const initial = {
      llm: { model: 'MiniMax-M2.7', apiKey: '', baseUrl: 'https://api.minimaxi.com/v1' },
      cron: { rssIntervalMinutes: 60, relinkCronExpression: '0 3 * * *' },
    };
    await POST(new Request('http://localhost/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initial),
    }));

    vi.clearAllMocks();

    // Update with new values
    const updated = {
      llm: { model: 'MiniMax-M2.7', apiKey: '', baseUrl: 'https://api.minimaxi.com/v1' },
      cron: { rssIntervalMinutes: 120, relinkCronExpression: '0 6 * * *' },
    };
    const res = await POST(new Request('http://localhost/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }));

    expect(res.status).toBe(200);
    expect(restartRSSCron).toHaveBeenCalledWith(120);
    expect(restartRelinkCron).toHaveBeenCalledWith('0 6 * * *');
  });
});
