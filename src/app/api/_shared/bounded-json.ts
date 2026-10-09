export class JsonBodyError extends Error {
  constructor(readonly status: 400 | 413) {
    super(status === 413 ? "Request body too large" : "Invalid request body");
    this.name = "JsonBodyError";
  }
}

/** Bound actual streamed bytes before decoding/parsing, even without an honest Content-Length. */
export async function readBoundedJson(request: Request, maxBytes: number, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new JsonBodyError(400);
    if (Number(declared) > maxBytes) throw new JsonBodyError(413);
  }
  if (!request.body) throw new JsonBodyError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Cancellation closes pending reads immediately; source cleanup may settle later or fail.
  // Never let that cleanup extend the input deadline or hide the controlled overflow error.
  const cancel = (reason?: unknown) => { void reader.cancel(reason).catch(() => {}); };
  const abort = () => cancel(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        cancel();
        throw new JsonBodyError(413);
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
