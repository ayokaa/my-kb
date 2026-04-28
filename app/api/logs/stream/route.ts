import { logger } from '@/lib/logger';
import type { LogEntry } from '@/lib/logger';

const encoder = new TextEncoder();
const HEARTBEAT_INTERVAL_MS = 30000;

export async function GET() {
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send recent history first
      const recent = logger.query({ limit: 50 });
      const historyPayload = JSON.stringify(recent.logs);
      controller.enqueue(encoder.encode(`event: history\ndata: ${historyPayload}\n\n`));

      // Subscribe to new logs
      unsubscribe = logger.onNewLog((entry: LogEntry) => {
        try {
          const payload = JSON.stringify(entry);
          controller.enqueue(encoder.encode(`event: log\ndata: ${payload}\n\n`));
        } catch {
          // Controller closed
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
        }
      });

      // Heartbeat
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(':ok\n\n'));
        } catch {
          clearInterval(heartbeat);
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Clean up on close
      const cleanup = () => {
        clearInterval(heartbeat);
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };

      // Signal abort handling
      if ('signal' in controller && (controller as any).signal) {
        (controller as any).signal.addEventListener('abort', cleanup);
      }
    },

    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
