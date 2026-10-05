import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export type DemoPersona = "ADMIN" | "MANAGER" | "TECHNICIAN";

export function parseDemoPersona(value: unknown): DemoPersona | null {
  return value === "ADMIN" || value === "MANAGER" || value === "TECHNICIAN"
    ? value
    : null;
}

/** Only a proxy-controlled address is accepted; a missing address fails closed. */
export function trustedDemoIp(headers: Headers): string | null {
  const value = headers.get("x-vercel-forwarded-for");
  if (!value || value.length > 128 || value.includes(",") || /[\r\n]/.test(value)) return null;
  const ip = value.trim();
  return isIP(ip) ? ip : null;
}

export function demoIpDigest(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

export function isSameOrigin(origin: string | null, requestUrl: URL): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === requestUrl.origin;
  } catch {
    return false;
  }
}

/** Next may normalize Request.url to localhost behind its own routing layer.
 * Compare the browser Origin with the inbound Host instead of that internal URL.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!origin || !host || host.includes(",")) return false;
  try {
    const parsed = new URL(origin);
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProto ? `${forwardedProto}:` : new URL(request.url).protocol;
    return parsed.host.toLowerCase() === host.toLowerCase() && parsed.protocol === protocol;
  } catch {
    return false;
  }
}
