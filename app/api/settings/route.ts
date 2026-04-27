import { loadSettings, saveSettings, safeSettings, type RuntimeSettings } from '@/lib/settings';
import { restartRSSCron } from '@/lib/rss/cron';
import { restartRelinkCron } from '@/lib/relink/cron';
import cron from 'node-cron';

export async function GET() {
  try {
    const settings = await loadSettings();
    return Response.json(safeSettings(settings));
  } catch (err) {
    console.error('[Settings API] GET error:', err);
    return Response.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const current = await loadSettings();

    const next: RuntimeSettings = {
      llm: {
        model: body.llm?.model ?? current.llm.model,
        apiKey: body.llm?.apiKey ?? current.llm.apiKey,
        baseUrl: body.llm?.baseUrl ?? current.llm.baseUrl,
      },
      cron: {
        rssIntervalMinutes: body.cron?.rssIntervalMinutes ?? current.cron.rssIntervalMinutes,
        relinkCronExpression: body.cron?.relinkCronExpression ?? current.cron.relinkCronExpression,
      },
    };

    // Validate cron expression
    if (!cron.validate(next.cron.relinkCronExpression)) {
      return Response.json({ error: `Invalid cron expression: ${next.cron.relinkCronExpression}` }, { status: 400 });
    }

    // Validate RSS interval
    if (typeof next.cron.rssIntervalMinutes !== 'number' || next.cron.rssIntervalMinutes < 1) {
      return Response.json({ error: 'RSS interval must be a positive number' }, { status: 400 });
    }

    await saveSettings(next);

    // Restart crons if changed
    if (next.cron.rssIntervalMinutes !== current.cron.rssIntervalMinutes) {
      restartRSSCron(next.cron.rssIntervalMinutes);
    }
    if (next.cron.relinkCronExpression !== current.cron.relinkCronExpression) {
      restartRelinkCron(next.cron.relinkCronExpression);
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('[Settings API] POST error:', err);
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
