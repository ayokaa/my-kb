/** Simple in-process SSE broadcaster for note changes.
 *  All controllers are cleaned up automatically on disconnect.
 */
const controllers = new Set<ReadableStreamDefaultController>();

const encoder = new TextEncoder();

export function broadcastNoteChanged() {
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
  controllers.add(controller);
}

export function removeNoteEventController(controller: ReadableStreamDefaultController) {
  controllers.delete(controller);
}
