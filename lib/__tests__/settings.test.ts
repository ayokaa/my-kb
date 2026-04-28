import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpDir = mkdtempSync(join(tmpdir(), 'kb-settings-test-'));
process.env.KNOWLEDGE_ROOT = tmpDir;

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { loadSettings, saveSettings, maskApiKey, safeSettings } from '../settings';

beforeEach(async () => {
  // Reset env overrides between tests
  delete process.env.LLM_MODEL;
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_BASE_URL;
  delete process.env.RSS_CHECK_INTERVAL_MINUTES;
  delete process.env.RELINK_CRON_EXPRESSION;
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadSettings', () => {
  it('returns defaults when no settings file exists', async () => {
    const settings = await loadSettings();
    expect(settings.llm.model).toBe('MiniMax-M2.7');
    expect(settings.llm.baseUrl).toBe('https://api.minimaxi.com/anthropic');
    expect(settings.cron.rssIntervalMinutes).toBe(60);
    expect(settings.cron.relinkCronExpression).toBe('0 3 * * *');
  });

  it('reads saved settings from file', async () => {
    await saveSettings({
      llm: { model: 'gpt-4', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      cron: { rssIntervalMinutes: 30, relinkCronExpression: '0 0 * * *' },
    });

    const settings = await loadSettings();
    expect(settings.llm.model).toBe('gpt-4');
    expect(settings.llm.baseUrl).toBe('https://api.openai.com/v1');
    expect(settings.cron.rssIntervalMinutes).toBe(30);
    expect(settings.cron.relinkCronExpression).toBe('0 0 * * *');
  });

  it('env variables override file values', async () => {
    await saveSettings({
      llm: { model: 'gpt-4', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      cron: { rssIntervalMinutes: 30, relinkCronExpression: '0 0 * * *' },
    });

    process.env.LLM_MODEL = 'env-model';
    process.env.RSS_CHECK_INTERVAL_MINUTES = '120';

    const settings = await loadSettings();
    expect(settings.llm.model).toBe('env-model');
    expect(settings.cron.rssIntervalMinutes).toBe(120);
    // Non-overridden fields still come from file
    expect(settings.llm.baseUrl).toBe('https://api.openai.com/v1');
  });
});

describe('saveSettings', () => {
  it('persists settings to YAML file', async () => {
    const original = await loadSettings();
    const next = {
      ...original,
      llm: { ...original.llm, model: 'custom-model' },
    };
    await saveSettings(next);

    const loaded = await loadSettings();
    expect(loaded.llm.model).toBe('custom-model');
  });
});

describe('maskApiKey', () => {
  it('masks the middle of a long key', () => {
    expect(maskApiKey('sk-abcdefghijklmnopqrstuvwxyz1234')).toBe('sk-...1234');
  });

  it('returns empty string for short keys', () => {
    expect(maskApiKey('short')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(maskApiKey('')).toBe('');
  });
});

describe('safeSettings', () => {
  it('masks apiKey in returned settings', () => {
    const settings = {
      llm: { model: 'gpt-4', apiKey: 'sk-abcdefghijklmnopqrstuvwxyz1234', baseUrl: 'https://api.openai.com/v1' },
      cron: { rssIntervalMinutes: 60, relinkCronExpression: '0 3 * * *' },
    };
    const safe = safeSettings(settings);
    expect(safe.llm.apiKey).toBe('sk-...1234');
    expect(safe.llm.model).toBe('gpt-4');
  });
});
