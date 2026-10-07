export class JsonBodyError extends Error {
  constructor(readonly status: 400 | 413) {
    super(status === 413 ? "Request body too large" : "Invalid request body");
    this.name = "JsonBodyError";
  }
}

/** Bound actual streamed bytes before decoding/parsing, even without an honest Content-Length. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new JsonBodyError(400);
    if (Number(declared) > maxBytes) throw new JsonBodyError(413);
  }
  if (!request.body) throw new JsonBodyError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // A failed cancellation must not change the controlled overflow response.
        try { await reader.cancel(); } catch { /* The stream may already be disconnected. */ }
        throw new JsonBodyError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
