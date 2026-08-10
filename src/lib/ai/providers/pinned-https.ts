import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";

import type { SafeProviderTarget } from "./safe-url";

const MAX_PROVIDER_RESPONSE_BYTES = 1_048_576;

function hostHeader(target: SafeProviderTarget): string {
  const hostname = isIP(target.hostname) === 6
    ? `[${target.hostname}]`
    : target.hostname;
  return target.endpoint.port && target.endpoint.port !== "443"
    ? `${hostname}:${target.endpoint.port}`
    : hostname;
}

export function buildPinnedHttpsRequestOptions(
  target: SafeProviderTarget,
  init: RequestInit,
): RequestOptions {
  const headers = Object.fromEntries(new Headers(init.headers).entries());

  return {
    protocol: "https:",
    hostname: target.connectAddress,
    port: target.endpoint.port ? Number(target.endpoint.port) : 443,
    family: isIP(target.connectAddress),
    method: init.method ?? "GET",
    path: `${target.endpoint.pathname}${target.endpoint.search}`,
    headers: {
      ...headers,
      host: hostHeader(target),
    },
    servername: isIP(target.hostname) === 0 ? target.hostname : undefined,
    rejectUnauthorized: true,
    agent: false,
    signal: init.signal ?? undefined,
  };
}

/**
 * Performs one HTTPS request to the address approved by the URL/DNS policy.
 * The HTTP Host header and TLS SNI retain the configured hostname, so
 * certificate verification remains bound to that hostname without a second
 * DNS lookup that could be changed by rebinding.
 */
export function pinnedHttpsFetch(
  target: SafeProviderTarget,
  init: RequestInit,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      buildPinnedHttpsRequestOptions(target, init),
      (incoming) => {
        const chunks: Buffer[] = [];
        let receivedBytes = 0;

        incoming.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += buffer.byteLength;
          if (receivedBytes > MAX_PROVIDER_RESPONSE_BYTES) {
            request.destroy(new Error("Provider response exceeded the allowed size."));
            return;
          }
          chunks.push(buffer);
        });
        incoming.on("error", reject);
        incoming.on("aborted", () => reject(new Error("Provider response aborted.")));
        incoming.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.set(name, value);
            }
          }

          resolve(
            new Response(Buffer.concat(chunks), {
              status: incoming.statusCode ?? 502,
              statusText: incoming.statusMessage,
              headers,
            }),
          );
        });
      },
    );

    request.on("error", reject);
    if (init.body !== undefined && init.body !== null) {
      if (typeof init.body !== "string") {
        request.destroy(new TypeError("Unsupported provider request body."));
        return;
      }
      request.write(init.body);
    }
    request.end();
  });
}
