import { join } from 'path';
import { runCamoufox } from './camoufox-runner';
import { isValidHttpUrl } from './rss';
import { logger } from '@/lib/logger';

const FETCH_TIMEOUT = 90000; // ms — Python 端 60s goto + 浏览器启动 + 提取

function execFileAsync(
  cmd: string,
  args: string[],
  opts: { timeout?: number; encoding?: BufferEncoding; maxBuffer?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    runCamoufox(cmd, args, opts, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout: stdout as string, stderr: stderr as string });
      }
    });
  });
}

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'fetch_web.py');

/** Resolve the Python binary: prefer project venv, fall back to system python3. */
function getPythonBin(): string {
  return join(process.cwd(), '.venv', 'bin', 'python3');
}

/** No-op: camoufox is launched per-call, no singleton browser to close. */
export async function closeBrowser(): Promise<void> {
  // nothing to do
}

/** Reset for tests: no-op since there is no singleton browser. */
export function resetBrowserForTesting() {
  // nothing to do
}

/**
 * Fetch via TinyFish SDK (primary when TINYFISH_API_KEY is set).
 */
async function fetchViaTinyFish(url: string): Promise<{ title: string; content: string; excerpt?: string }> {
  const { TinyFish } = await import('@tiny-fish/sdk');
  const client = new TinyFish();
  const resp = await client.fetch.getContents({ urls: [url], format: 'markdown' });

  if (resp.errors && resp.errors.length > 0) {
    throw new Error(`TinyFish fetch error: ${resp.errors[0].error}`);
  }

  const result = resp.results?.[0];
  if (!result || !result.text) {
    throw new Error(`TinyFish returned empty content for ${url}`);
  }

  return {
    title: result.title || url,
    content: result.text.slice(0, 10000),
    excerpt: result.text.slice(0, 200),
  };
}

/**
 * Fetch via Camoufox + trafilatura (fallback).
 */
async function fetchViaCamoufox(url: string): Promise<{ title: string; content: string; excerpt?: string }> {
  const { stdout } = await execFileAsync(getPythonBin(), [SCRIPT_PATH, url], {
    timeout: FETCH_TIMEOUT,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });

  let parsed: { title?: string; content?: string };
  try {
    parsed = JSON.parse(stdout.trim()) as { title?: string; content?: string };
  } catch (parseErr) {
    const raw = stdout.trim().slice(0, 500);
    throw new Error(
      `Failed to parse web fetch result for ${url}: ${(parseErr as Error).message}. Raw stdout: ${raw || '(empty)'}`
    );
  }

  const title = parsed.title || url;
  const content = parsed.content || '';

  if (!content.trim()) {
    throw new Error(`Web fetch succeeded but returned empty content for ${url} (page may have timed out or requires JS rendering)`);
  }

  return {
    title: title || url,
    content: content.slice(0, 10000),
    excerpt: content.slice(0, 200),
  };
}

export async function fetchWebContent(url: string): Promise<{ title: string; content: string; excerpt?: string }> {
  if (!isValidHttpUrl(url)) {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Primary: TinyFish (when API key is configured)
  if (process.env.TINYFISH_API_KEY) {
    try {
      return await fetchViaTinyFish(url);
    } catch (err) {
      logger.warn('Web', `TinyFish fetch failed, falling back to Camoufox: ${(err as Error).message}`);
    }
  }

  // Fallback: Camoufox + trafilatura
  return fetchViaCamoufox(url);
}
