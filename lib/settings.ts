import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import yaml from 'js-yaml';

export interface LLMSettings {
  model: string;
  apiKey: string;
  baseUrl: string;
}

export interface CronSettings {
  rssIntervalMinutes: number;
  relinkCronExpression: string;
}

export interface MemorySettings {
  taskIntervalMs: number;
}

export interface DigestSettings {
  autoDigest: boolean;
}

export interface RuntimeSettings {
  llm: LLMSettings;
  cron: CronSettings;
  memory: MemorySettings;
  digest: DigestSettings;
}

const DEFAULT_SETTINGS: RuntimeSettings = {
  llm: {
    model: 'MiniMax-M2.7',
    apiKey: '',
    baseUrl: 'https://api.minimaxi.com/anthropic',
  },
  cron: {
    rssIntervalMinutes: 60,
    relinkCronExpression: '0 3 * * *',
  },
  memory: {
    taskIntervalMs: 30_000,
  },
  digest: {
    autoDigest: true,
  },
};

export function getSettingsPath(): string {
  return join(process.cwd(), process.env.KNOWLEDGE_ROOT || 'knowledge', 'meta', 'settings.yml');
}

function envOverride(settings: RuntimeSettings): RuntimeSettings {
  return {
    llm: {
      model: process.env.LLM_MODEL || settings.llm.model,
      apiKey: process.env.ANTHROPIC_API_KEY || settings.llm.apiKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL || settings.llm.baseUrl,
    },
    cron: {
      rssIntervalMinutes: parseInt(process.env.RSS_CHECK_INTERVAL_MINUTES || String(settings.cron.rssIntervalMinutes), 10),
      relinkCronExpression: process.env.RELINK_CRON_EXPRESSION || settings.cron.relinkCronExpression,
    },
    memory: {
      taskIntervalMs: settings.memory?.taskIntervalMs ?? DEFAULT_SETTINGS.memory.taskIntervalMs,
    },
    digest: {
      autoDigest: settings.digest?.autoDigest ?? DEFAULT_SETTINGS.digest.autoDigest,
    },
  };
}

export async function loadSettings(): Promise<RuntimeSettings> {
  const path = getSettingsPath();
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = yaml.load(raw) as Partial<RuntimeSettings> | null;
    if (!parsed) return envOverride(DEFAULT_SETTINGS);

    const merged: RuntimeSettings = {
      llm: {
        model: parsed.llm?.model || DEFAULT_SETTINGS.llm.model,
        apiKey: parsed.llm?.apiKey || DEFAULT_SETTINGS.llm.apiKey,
        baseUrl: parsed.llm?.baseUrl || DEFAULT_SETTINGS.llm.baseUrl,
      },
      cron: {
        rssIntervalMinutes: parsed.cron?.rssIntervalMinutes || DEFAULT_SETTINGS.cron.rssIntervalMinutes,
        relinkCronExpression: parsed.cron?.relinkCronExpression || DEFAULT_SETTINGS.cron.relinkCronExpression,
      },
      memory: {
        taskIntervalMs: parsed.memory?.taskIntervalMs || DEFAULT_SETTINGS.memory.taskIntervalMs,
      },
      digest: {
        autoDigest: parsed.digest?.autoDigest ?? DEFAULT_SETTINGS.digest.autoDigest,
      },
    };
    return envOverride(merged);
  } catch {
    return envOverride(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(settings: RuntimeSettings): Promise<void> {
  const path = getSettingsPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${Date.now()}`;
  await writeFile(tmp, yaml.dump(settings));
  await rename(tmp, path);
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '';
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}

export function safeSettings(settings: RuntimeSettings): RuntimeSettings {
  return {
    ...settings,
    llm: {
      ...settings.llm,
      apiKey: maskApiKey(settings.llm.apiKey),
    },
  };
}
