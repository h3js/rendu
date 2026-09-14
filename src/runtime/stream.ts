import { createWrite, discard, type StreamState } from "./_shared.ts";

/**
 * Streaming runtime for a template without `defer()`: `concatStreams()` writes the chunks in
 * source order, as they are.
 *
 * Without `defer()` nothing can be queued, so none of the patch machinery (`defer.ts`)
 * could ever run: keep defer-only code out of here.
 */

export default function concatStreams(chunks: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const state: StreamState = { cancelled: false, activeReader: undefined };
  /**
   * Cancel the output, or clean up after a chunk failed it: the chunk being written releases
   * itself (`write()`), the others are discarded (those already written are closed by now).
   */
  const abort = (reason: unknown) => {
    state.cancelled = true;
    state.reason = reason;
    const reader = state.activeReader;
    state.activeReader = undefined;
    for (const chunk of chunks) discard(chunk, reason);
    return reader?.cancel(reason);
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const enqueue = (value: unknown) => {
        if (state.cancelled) return;
        controller.enqueue(
          ArrayBuffer.isView(value) ? (value as Uint8Array) : encoder.encode(String(value)),
        );
      };
      const write = createWrite(state, enqueue);
      try {
        for (const chunk of chunks) {
          if (state.cancelled) return;
          await write(chunk);
        }
      } catch (error) {
        abort(error);
        throw error;
      }
      if (state.cancelled) return;
      controller.close();
    },
    cancel: abort,
  });
}
