import { verifyMcpBearer } from "@/lib/mcp/bearer-actor";
import { createWorkspaceMcpHandler } from "@/lib/mcp/workspace-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(status: number, message: string) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(status === 401 ? { "WWW-Authenticate": 'Bearer realm="Sejuk Ops MCP"' } : {}),
    },
  });
}

async function handle(request: Request): Promise<Response> {
  if (process.env.MCP_EXTERNAL_ENABLED !== "true") return response(404, "Not found");
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host");
  if (host && (host.includes(",") || /[\r\n\s]/.test(host))) return response(403, "Forbidden");
  // Next can normalize Request.url to localhost behind its router. The inbound
  // Host is authoritative for Origin checks; only non-local URL conflicts deny.
  if (host && host.toLowerCase() !== requestUrl.host.toLowerCase()
      && !["localhost", "127.0.0.1"].includes(requestUrl.hostname)) {
    return response(403, "Forbidden");
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const forwardedProto = request.headers.get("x-forwarded-proto");
      const protocol = forwardedProto ? `${forwardedProto}:` : requestUrl.protocol;
      if (!host || !["http:", "https:"].includes(protocol)
          || new URL(origin).origin !== new URL(`${protocol}//${host}`).origin) {
        return response(403, "Forbidden");
      }
    } catch { return response(403, "Forbidden"); }
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > 64_000) return response(413, "Request too large");
  let identity;
  try {
    identity = await verifyMcpBearer(request);
  } catch {
    return response(401, "Unauthorized");
  }
  try {
    const handler = createWorkspaceMcpHandler(identity);
    const result = await handler.fetch(request);
    const headers = new Headers(result.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(result.body, { status: result.status, headers });
  } catch {
    return response(500, "MCP unavailable");
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
