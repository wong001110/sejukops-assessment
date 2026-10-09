import { describe, expect, it, vi } from "vitest";
import { JsonBodyError, readBoundedJson } from "./bounded-json";

function input(bytes: Uint8Array, declared?: string, cancel = vi.fn()) {
  let delivered = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { if (delivered) { controller.close(); return; } delivered = true; controller.enqueue(bytes); },
    cancel,
  }, { highWaterMark: 0 });
  return { request: new Request("https://app.example.com", { method: "POST", body: stream, duplex: "half",
    headers: declared === undefined ? {} : { "Content-Length": declared } } as RequestInit), cancel };
}

describe("bounded JSON stream reader", () => {
  it("accepts the exact byte limit and UTF-8 content", async () => {
    const value = { text: "界🙂" };
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    expect(await readBoundedJson(input(bytes).request, bytes.length)).toEqual(value);
  });

  it("counts bytes rather than Unicode characters", async () => {
    const text = JSON.stringify({ text: "界🙂" });
    const probe = input(new TextEncoder().encode(text));
    await expect(readBoundedJson(probe.request, text.length)).rejects.toMatchObject({ status: 413 });
    expect(probe.cancel).toHaveBeenCalledOnce();
  });

  it.each([undefined, "0", "1"])("enforces actual bytes with absent or dishonest declaration %s", async (declared) => {
    const probe = input(new TextEncoder().encode('{"text":"abcdef"}'), declared);
    await expect(readBoundedJson(probe.request, 8)).rejects.toMatchObject({ status: 413 });
    expect(probe.cancel).toHaveBeenCalledOnce(); expect(probe.request.body?.locked).toBe(false);
  });

  it("preserves overflow classification when cancelling a disconnected stream fails", async () => {
    const probe = input(new TextEncoder().encode("{}"), undefined, vi.fn().mockRejectedValue(new Error("disconnected")));
    await expect(readBoundedJson(probe.request, 1)).rejects.toMatchObject({ status: 413 });
    expect(probe.request.body?.locked).toBe(false);
  });

  it.each(["-1", "1.5", "abc", "1,2"])("rejects malformed Content-Length %s", async (declared) => {
    const probe = input(new TextEncoder().encode("{}"), declared);
    await expect(readBoundedJson(probe.request, 8)).rejects.toMatchObject({ status: 400 });
    expect(probe.request.bodyUsed).toBe(false);
  });

  it("rejects an oversized declaration before reading", async () => {
    const probe = input(new TextEncoder().encode("{}"), "9");
    await expect(readBoundedJson(probe.request, 8)).rejects.toMatchObject({ status: 413 });
    expect(probe.request.bodyUsed).toBe(false);
  });

  it("rejects absent, malformed or invalid-UTF8 input rather than reinterpreting it", async () => {
    await expect(readBoundedJson(new Request("https://app.example.com", { method: "POST" }), 8)).rejects.toBeInstanceOf(JsonBodyError);
    const malformed = input(new TextEncoder().encode("{"));
    await expect(readBoundedJson(malformed.request, 8)).rejects.toBeInstanceOf(SyntaxError);
    expect(malformed.request.body?.locked).toBe(false);
    await expect(readBoundedJson(input(new Uint8Array([0xff])).request, 8)).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects pre-aborted input before acquiring or consuming the stream", async () => {
    const controller = new AbortController(); const reason = new DOMException("Synthetic stop", "AbortError");
    controller.abort(reason); const probe = input(new TextEncoder().encode("{}"));
    await expect(readBoundedJson(probe.request, 8, controller.signal)).rejects.toBe(reason);
    expect(probe.request.bodyUsed).toBe(false); expect(probe.request.body?.locked).toBe(false); expect(probe.cancel).not.toHaveBeenCalled();
  });

  it.each(["pending", "rejected"])("aborts a pending read and releases its lock even when source cleanup is %s", async (mode) => {
    const controller = new AbortController(), reason = new DOMException("Synthetic timeout", "TimeoutError");
    const cancel = vi.fn(() => mode === "pending" ? new Promise<void>(() => {}) : Promise.reject(new Error("Synthetic cleanup failure")));
    const pull = vi.fn(); const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    const request = new Request("https://app.example.com", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = readBoundedJson(request, 8, controller.signal);
    await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce()); controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason); expect(request.body?.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("returns controlled overflow without waiting for never-settling source cleanup", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const probe = input(new TextEncoder().encode("{} "), undefined, cancel);
    await expect(readBoundedJson(probe.request, 2)).rejects.toMatchObject({ status: 413 });
    expect(probe.cancel).toHaveBeenCalledOnce(); expect(probe.request.body?.locked).toBe(false);
  });

  it("preserves Unicode across one-byte chunks and removes its signal listener on success", async () => {
    const value = { text: "界🙂" }, bytes = new TextEncoder().encode(JSON.stringify(value));
    let position = 0; const cancel = vi.fn(), controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const stream = new ReadableStream<Uint8Array>({ pull(target) {
      if (position === bytes.length) target.close(); else target.enqueue(bytes.slice(position, ++position));
    }, cancel }, { highWaterMark: 0 });
    const request = new Request("https://app.example.com", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readBoundedJson(request, bytes.length, controller.signal)).toEqual(value);
    expect(request.body?.locked).toBe(false); expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort(); expect(cancel).not.toHaveBeenCalled();
  });
});
