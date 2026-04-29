import { addNoteEventController, removeNoteEventController } from '@/lib/events';

const encoder = new TextEncoder();
const HEARTBEAT_INTERVAL_MS = 30000;

export async function GET() {
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      addNoteEventController(controller);
      // Send initial heartbeat to establish connection
      controller.enqueue(encoder.encode(':ok\n\n'));

      // Heartbeat to keep the connection alive across proxies / load balancers
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(':ok\n\n'));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Handle abort signal (Next.js may use AbortSignal on the request)
      if ('signal' in controller && (controller as any).signal) {
        (controller as any).signal.addEventListener('abort', cleanup);
      }
    },
    cancel(controller) {
      removeNoteEventController(controller);
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
