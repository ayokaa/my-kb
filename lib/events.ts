/** Simple in-process SSE broadcaster for note changes.
 *  Controllers are added on SSE connect and removed on disconnect.
 *  Stale controllers (from dropped connections where cancel wasn't called)
 *  are lazily cleaned up when the set exceeds MAX_CONTROLLERS.
 */
const controllers = new Set<ReadableStreamDefaultController>();
const MAX_CONTROLLERS = 50;

const encoder = new TextEncoder();

function cleanupStaleControllers() {
  const heartbeat = encoder.encode(':ok\n\n');
  for (const controller of controllers) {
    try {
      controller.enqueue(heartbeat);
    } catch {
      controllers.delete(controller);
    }
  }
}

export function broadcastNoteChanged() {
  // Lazily purge stale controllers when the set grows too large
  if (controllers.size > MAX_CONTROLLERS) {
    cleanupStaleControllers();
  }

  const message = encoder.encode('data: changed\n\n');
  for (const controller of controllers) {
    try {
      controller.enqueue(message);
    } catch {
      controllers.delete(controller);
    }
  }
}

export function addNoteEventController(controller: ReadableStreamDefaultController) {
  // Proactive cleanup when adding a new controller
  if (controllers.size >= MAX_CONTROLLERS) {
    cleanupStaleControllers();
  }
  controllers.add(controller);
}

export function removeNoteEventController(controller: ReadableStreamDefaultController) {
  controllers.delete(controller);
}
