import { join } from 'path';
import { runCamoufox } from './camoufox-runner';

const FETCH_TIMEOUT = 60000; // ms (includes process spawn + browser launch + navigation + extraction)

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
  const { stdout } = await execFileAsync('python3', [SCRIPT_PATH, url], {
    timeout: FETCH_TIMEOUT,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024, // 10MB for large pages
  });

  const parsed = JSON.parse(stdout.trim()) as { title: string; content: string };
  const title = parsed.title || url;
  const content = parsed.content || '';

  return {
    title: title || url,
    content: content.slice(0, 10000),
    excerpt: content.slice(0, 200),
  };
}
