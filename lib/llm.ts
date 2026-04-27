import OpenAI from 'openai';
import { loadSettings } from './settings';

let cachedClient: OpenAI | null = null;
let cachedSettingsKey: string | null = null;

function settingsKey(s: Awaited<ReturnType<typeof loadSettings>>): string {
  return `${s.llm.apiKey}:${s.llm.baseUrl}`;
}

export async function getLLMClient(): Promise<OpenAI> {
  const settings = await loadSettings();
  const key = settingsKey(settings);
  if (!cachedClient || cachedSettingsKey !== key) {
    cachedClient = new OpenAI({
      apiKey: settings.llm.apiKey,
      baseURL: settings.llm.baseUrl,
      dangerouslyAllowBrowser: true,
    });
    cachedSettingsKey = key;
  }
  return cachedClient;
}

export async function getLLMModel(): Promise<string> {
  const settings = await loadSettings();
  return settings.llm.model;
}

/** 一次性返回 client 和 model，确保一致性 */
export async function getLLM(): Promise<{ client: OpenAI; model: string }> {
  const settings = await loadSettings();
  const key = settingsKey(settings);
  if (!cachedClient || cachedSettingsKey !== key) {
    cachedClient = new OpenAI({
      apiKey: settings.llm.apiKey,
      baseURL: settings.llm.baseUrl,
      dangerouslyAllowBrowser: true,
    });
    cachedSettingsKey = key;
  }
  return { client: cachedClient, model: settings.llm.model };
}

/** 仅供测试使用：重置客户端缓存 */
export function __resetLLMCache() {
  cachedClient = null;
  cachedSettingsKey = null;
}
