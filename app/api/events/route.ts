import { addNoteEventController, removeNoteEventController } from '@/lib/events';

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      addNoteEventController(controller);
      // Send initial heartbeat to establish connection
      controller.enqueue(new TextEncoder().encode(':ok\n\n'));
    },
    cancel(controller) {
      removeNoteEventController(controller);
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
