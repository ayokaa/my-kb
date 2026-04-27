import OpenAI from 'openai';
import { loadSettings } from './settings';

export async function getLLMClient(): Promise<OpenAI> {
  const settings = await loadSettings();
  return new OpenAI({
    apiKey: settings.llm.apiKey,
    baseURL: settings.llm.baseUrl,
    dangerouslyAllowBrowser: true,
  });
}

export async function getLLMModel(): Promise<string> {
  const settings = await loadSettings();
  return settings.llm.model;
}
