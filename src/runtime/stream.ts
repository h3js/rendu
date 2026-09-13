import { createWrite, type StreamState } from "./_shared.ts";

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
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const enqueue = (value: unknown) => {
        if (state.cancelled) return;
        controller.enqueue(
          ArrayBuffer.isView(value) ? (value as Uint8Array) : encoder.encode(String(value)),
        );
      };
      const write = createWrite(state, enqueue);
      for (const chunk of chunks) {
        if (state.cancelled) return;
        await write(chunk);
      }
      if (state.cancelled) return;
      controller.close();
    },
    cancel(reason) {
      state.cancelled = true;
      const reader = state.activeReader;
      state.activeReader = undefined;
      return reader?.cancel(reason);
    },
  });
}
