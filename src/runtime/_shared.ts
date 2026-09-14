/** The prelude's sink (`prelude.ts`): cleared once the body has ended. */
declare let __sink__: unknown[] | undefined;

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | undefined)?.then === "function";
}

/**
 * Call a function chunk with its own `__sink__` (see `prelude.ts`) and return its result together
 * with the chunks it echoed synchronously, which the caller writes right before the result.
 * `__sink__` is reset to `undefined`, not to the previous sink: the runtime only calls function
 * chunks once the body has ended, and the call is synchronous, so nothing else can run in between.
 *
 * The result is written after the echoed chunks, which can take a while, so a promise result
 * gets a rejection handler right away (awaiting it later still throws): otherwise its rejection
 * would be unhandled in the meantime.
 */
export function callEchoed(fn: () => unknown): [result: unknown, echoed: unknown[]] {
  const echoed: unknown[] = (__sink__ = []);
  let result: unknown;
  try {
    result = fn();
  } catch (error) {
    // What it echoed before throwing will not be written either.
    for (const chunk of echoed) discard(chunk, error);
    throw error;
  } finally {
    __sink__ = undefined;
  }
  if (echoed.length > 0 && isThenable(result)) {
    result.then(undefined, () => {});
  }
  return [result, echoed];
}

/**
 * Release a chunk that will not be written (the output was cancelled or the render failed):
 * cancel its `ReadableStream` or `Response` body, now or once a promise resolves to one. A
 * function is not called, and a locked body is left to whoever holds its reader.
 */
export function discard(chunk: unknown, reason: unknown): void {
  if (isThenable(chunk)) {
    chunk.then(
      (value) => discard(value, reason),
      () => {},
    );
    return;
  }
  const body = chunk instanceof Response ? chunk.body : chunk;
  if (body instanceof ReadableStream && !body.locked) body.cancel(reason).catch(() => {});
}

/** State that `concatStreams()` shares between `write()`, its flush loop and `cancel()`. */
export interface StreamState {
  cancelled: boolean;
  /** The cancel reason (or the error that failed the render), passed on to `discard()`. */
  reason?: unknown;
  /** The reader of the stream chunk being written, cancelled along with the output. */
  activeReader: ReadableStreamDefaultReader<unknown> | undefined;
}

/**
 * `write(chunk)`: resolve a chunk (function, promise, `Response`, `ReadableStream`, anything
 * else) and hand its content to `enqueue`, in order.
 *
 * A function chunk is called through `callEchoed()` and what it echoed is written right before
 * its result, recursively, so that output lands in place whether the chunk is in the main
 * document or in a `defer()` patch.
 *
 * Once the output is cancelled, a chunk is discarded instead: a function is no longer called and
 * no reader is acquired, not even for a stream a pending promise resolves to later.
 */
export function createWrite(
  state: StreamState,
  enqueue: (value: unknown) => void,
): (chunk: unknown) => Promise<void> {
  const write = async (chunk: unknown): Promise<void> => {
    if (typeof chunk === "function" && !state.cancelled) {
      const [result, echoed] = callEchoed(chunk as () => unknown);
      chunk = result;
      try {
        for (const part of echoed) {
          await write(part);
        }
      } catch (error) {
        for (const part of [...echoed, result]) discard(part, error);
        throw error;
      }
    }
    if (isThenable(chunk) && !state.cancelled) {
      chunk = await chunk;
    }
    if (state.cancelled) {
      discard(chunk, state.reason);
      return;
    }
    if (chunk instanceof Response) {
      chunk = chunk.body;
    }
    if (chunk === null || chunk === undefined) {
      return;
    }
    if (chunk instanceof ReadableStream) {
      const reader: ReadableStreamDefaultReader<unknown> = chunk.getReader();
      state.activeReader = reader;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (state.cancelled) return;
          enqueue(value);
        }
      } finally {
        state.activeReader = undefined;
        reader.releaseLock();
      }
    } else {
      enqueue(chunk);
    }
  };
  return write;
}
