import { join } from 'path';
import { runCamoufox } from './camoufox-runner';
import { isValidHttpUrl } from './rss';

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

/** No-op: camoufox is launched per-call, no singleton browser to close. */
export async function closeBrowser(): Promise<void> {
  // nothing to do
}

/** Reset for tests: no-op since there is no singleton browser. */
export function resetBrowserForTesting() {
  // nothing to do
}

export async function fetchWebContent(url: string): Promise<{ title: string; content: string; excerpt?: string }> {
  if (!isValidHttpUrl(url)) {
    throw new Error(`Invalid URL: ${url}`);
  }

  const { stdout } = await execFileAsync('python3', [SCRIPT_PATH, url], {
    timeout: FETCH_TIMEOUT,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024, // 10MB for large pages
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
