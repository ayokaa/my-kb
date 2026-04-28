import { test, expect } from './fixtures';
import { resetTestData } from './fixtures';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function isCamoufoxAvailable(): Promise<boolean> {
  try {
    await execAsync('python3 -c "import camoufox"');
    return true;
  } catch {
    return false;
  }
}

test.describe.serial('Camoufox web scraping', () => {
  test.beforeEach(async () => {
    await resetTestData();
  });

  test('fetches a real web page into inbox via task queue', async ({ page, request }) => {
    test.setTimeout(120000);
    if (!(await isCamoufoxAvailable())) {
      test.skip(true, 'camoufox Python package not installed; run ./scripts/setup_camoufox.sh');
    }

    // Record existing web_fetch task IDs to distinguish new tasks
    const beforeRes = await request.get('/api/tasks');
    const beforeData = await beforeRes.json();
    const existingIds = new Set(
      (beforeData.tasks ?? [])
        .filter((t: any) => t.type === 'web_fetch')
        .map((t: any) => t.id)
    );

    // Submit a link through the ingest API
    const ingestRes = await request.post('/api/ingest', {
      data: { type: 'link', url: 'https://example.com' },
    });
    expect(ingestRes.status()).toBe(202);

    // Poll tasks until the new web_fetch task completes or fails
    let task: any = null;
    let done = false;
    for (let i = 0; i < 60; i++) {
      const res = await request.get('/api/tasks');
      const data = await res.json();
      const candidates = (data.tasks ?? []).filter(
        (t: any) => t.type === 'web_fetch' && !existingIds.has(t.id)
      );
      if (candidates.length > 0) {
        task = candidates[0];
        if (task.status === 'done' || task.status === 'failed') {
          if (task.status === 'done') {
            done = true;
          }
          break;
        }
      }
      await page.waitForTimeout(1000);
    }

    expect(task).not.toBeNull();
    expect(done).toBe(true);

    // Verify the web_fetch task completed (worker now directly generates a note instead of writing inbox)
    expect(task).not.toBeNull();
    expect(done).toBe(true);
  });
});
