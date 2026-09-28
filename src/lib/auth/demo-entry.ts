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
