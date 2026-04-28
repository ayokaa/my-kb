import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLoadSettings, mockSettings } = vi.hoisted(() => {
  const mockLoadSettings = vi.fn();
  const mockSettings = { llm: { apiKey: 'test-key', baseUrl: 'https://api.test.com/v1', model: 'test-model' } };
  return { mockLoadSettings, mockSettings };
});

vi.mock('../settings', () => ({
  loadSettings: mockLoadSettings.mockResolvedValue(mockSettings),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(function (opts: any) {
    return { _opts: opts };
  }),
}));

import { getLLMClient, getLLMModel, __resetLLMCache } from '../llm';

describe('getLLMClient', () => {
  beforeEach(() => {
    mockLoadSettings.mockClear();
    __resetLLMCache();
  });

  it('caches client instance across calls', async () => {
    const client1 = await getLLMClient();
    const client2 = await getLLMClient();
    // Same instance returned (cached)
    expect(client1).toBe(client2);
  });

  it('creates new client when settings change', async () => {
    const client1 = await getLLMClient();
    // Change settings
    mockLoadSettings.mockResolvedValue({
      llm: { apiKey: 'new-key', baseUrl: 'https://api.new.com/v1', model: 'new-model' },
    });
    const client2 = await getLLMClient();
    expect(client1).not.toBe(client2);
  });
});

describe('getLLMModel', () => {
  beforeEach(() => {
    mockLoadSettings.mockClear();
    mockLoadSettings.mockResolvedValue(mockSettings);
    __resetLLMCache();
  });

  it('returns model from settings', async () => {
    const model = await getLLMModel();
    expect(model).toBe('test-model');
  });
});

describe('getLLM (consistency)', () => {
  beforeEach(() => {
    mockLoadSettings.mockClear();
    mockLoadSettings.mockResolvedValue(mockSettings);
    __resetLLMCache();
  });

  it('getLLMClient and getLLMModel use the same settings snapshot', async () => {
    // If both read from the same cached settings, they should be consistent
    const { getLLM } = await import('../llm');
    const { client, model } = await getLLM();
    expect(client).toBeDefined();
    expect(model).toBe('test-model');
  });
});
