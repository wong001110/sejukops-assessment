import { nativeAgentEventSchema, type NativeAgentEvent } from "@/domain/agent-workspace/contracts";

/** Bounded NDJSON transport. A cut-off or invalid stream cannot be a completed run. */
export async function readNativeAgentStream(
  response: Response,
  onEvent: (event: NativeAgentEvent) => void,
  signal: AbortSignal,
) {
  if (!response.body) throw new Error("The agent response was empty. Please retry.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let eventCount = 0;
  let startedRunId: string | null = null;
  let terminal = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  function consume(line: string) {
    if (!line.trim()) return;
    if (++eventCount > 64 || line.length > 128_000 || terminal) throw new Error("The agent response was invalid. Please retry.");
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error("The agent response was incomplete. Please retry."); }
    const parsed = nativeAgentEventSchema.safeParse(value);
    if (!parsed.success) throw new Error("The agent response could not be verified. Please retry.");
    const event = parsed.data;
    if (event.type === "started") {
      if (startedRunId) throw new Error("The agent response was invalid. Please retry.");
      startedRunId = event.runId;
    } else if (!startedRunId) throw new Error("The agent response was invalid. Please retry.");
    if (event.type === "workspace") {
      if (event.workspace.runId !== startedRunId) throw new Error("The agent response did not match this run. Please retry.");
      terminal = true;
    }
    if (event.type === "error") terminal = true;
    onEvent(event);
  }
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_000_000) throw new Error("The agent response was too large. Please retry.");
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (buffer.length > 128_000) throw new Error("The agent response was too large. Please retry.");
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!terminal) throw new Error("The agent stopped before returning a result. Please retry.");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
