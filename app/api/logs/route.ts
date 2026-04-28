import { logger } from '@/lib/logger';
import type { LogLevel } from '@/lib/logger';

const VALID_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function parseLevels(value: string | null): LogLevel | LogLevel[] | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map((s) => s.trim() as LogLevel);
  const valid = parts.filter((l) => VALID_LEVELS.includes(l));
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  return valid;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const level = parseLevels(searchParams.get('level'));
    const module = searchParams.get('module') || undefined;
    const search = searchParams.get('search') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 1000);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);
    const from = searchParams.get('from') || undefined;

    const result = logger.query({ level, module, search, limit, offset, from });
    return Response.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    logger.clear();
    return Response.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
