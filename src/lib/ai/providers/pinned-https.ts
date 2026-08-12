import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";

import {
  providerObservationResponseHeaders,
  recordAIProviderExchange,
  sanitizeAIProviderPayload,
} from "@/lib/observability/ai-provider-observation-server";

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

function parseProviderBody(body: RequestInit["body"]): unknown {
  if (typeof body !== "string") return body == null ? undefined : "[non-text provider body omitted]";
  try { return JSON.parse(body); }
  catch { return body; }
}

function modelFromProviderBody(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "unknown";
  const model = Reflect.get(body, "model");
  return typeof model === "string" && model.trim() ? model : "unknown";
}

function responsePayload(buffer: Buffer, headers: Headers): unknown {
  const text = buffer.toString("utf8");
  if (!text) return undefined;
  if ((headers.get("content-type") ?? "").includes("application/json")) {
    try { return JSON.parse(text); }
    catch { return text; }
  }
  return text;
}

/**
 * Performs one HTTPS request to the address approved by the URL/DNS policy.
 * The HTTP Host header and TLS SNI retain the configured hostname, so
 * certificate verification remains bound to that hostname without a second
 * DNS lookup that could be changed by rebinding.
 *
 * When an AI observation context is active, the exact JSON body sent to the
 * provider and its raw JSON response are recorded after secret/base64
 * redaction. Authorization is never copied into the observation payload.
 */
export function pinnedHttpsFetch(
  target: SafeProviderTarget,
  init: RequestInit,
): Promise<Response> {
  const startedAt = Date.now();
  const parsedRequestBody = parseProviderBody(init.body);
  const model = modelFromProviderBody(parsedRequestBody);
  const requestHeaders = new Headers(init.headers);
  let observationRecorded = false;

  const recordFailure = (error: unknown) => {
    if (observationRecorded) return;
    observationRecorded = true;
    recordAIProviderExchange({
      providerType: "OPENAI_COMPATIBLE",
      endpoint: target.endpoint.toString(),
      model,
      method: "POST",
      statusCode: 0,
      statusText: "NETWORK_ERROR",
      durationMs: Math.max(0, Date.now() - startedAt),
      request: {
        headers: {
          accept: requestHeaders.get("accept") ?? "application/json",
          "content-type": requestHeaders.get("content-type") ?? "application/json",
          authorization: "[REDACTED]",
        },
        body: sanitizeAIProviderPayload(parsedRequestBody),
      },
      response: { headers: {}, body: undefined },
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : "Provider request failed",
      },
    });
  };

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
        incoming.on("error", (error) => {
          recordFailure(error);
          reject(error);
        });
        incoming.on("aborted", () => {
          const error = new Error("Provider response aborted.");
          recordFailure(error);
          reject(error);
        });
        incoming.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.set(name, value);
            }
          }

          const buffer = Buffer.concat(chunks);
          const statusCode = incoming.statusCode ?? 502;
          const statusText = incoming.statusMessage ?? "";
          if (!observationRecorded) {
            observationRecorded = true;
            recordAIProviderExchange({
              providerType: "OPENAI_COMPATIBLE",
              endpoint: target.endpoint.toString(),
              model,
              method: "POST",
              statusCode,
              statusText,
              durationMs: Math.max(0, Date.now() - startedAt),
              request: {
                headers: {
                  accept: requestHeaders.get("accept") ?? "application/json",
                  "content-type": requestHeaders.get("content-type") ?? "application/json",
                  authorization: "[REDACTED]",
                },
                body: sanitizeAIProviderPayload(parsedRequestBody),
              },
              response: {
                headers: providerObservationResponseHeaders(headers),
                body: sanitizeAIProviderPayload(responsePayload(buffer, headers)),
              },
            });
          }

          resolve(
            new Response(buffer, {
              status: statusCode,
              statusText,
              headers,
            }),
          );
        });
      },
    );

    request.on("error", (error) => {
      recordFailure(error);
      reject(error);
    });
    if (init.body !== undefined && init.body !== null) {
      if (typeof init.body !== "string") {
        const error = new TypeError("Unsupported provider request body.");
        recordFailure(error);
        request.destroy(error);
        return;
      }
      request.write(init.body);
    }
    request.end();
  });
}
