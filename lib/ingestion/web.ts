import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { join } from 'path';
import { runCamoufox } from './camoufox-runner';

const FETCH_TIMEOUT = 30000; // ms (includes process spawn + browser launch + navigation)

function execFileAsync(
  cmd: string,
  args: string[],
  opts: { timeout?: number; encoding?: BufferEncoding }
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
  });

  const parsed = JSON.parse(stdout.trim()) as { title: string; html: string; bodyText?: string };
  const title = parsed.title || url;
  const html = parsed.html || '';

  // Parse with Readability on the fully-rendered DOM
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();

  if (article) {
    return {
      title: article.title || title || url,
      content: article.textContent || '',
      excerpt: article.excerpt || '',
    };
  }

  // Fallback: plain body text (provided by Camoufox via real browser)
  const bodyText = parsed.bodyText || '';
  return {
    title: title || url,
    content: bodyText.slice(0, 10000),
    excerpt: bodyText.slice(0, 200),
  };
}
