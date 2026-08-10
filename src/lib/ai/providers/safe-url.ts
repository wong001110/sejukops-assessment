import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import {
  isPublicProviderAddress,
  type ResolvedAddress,
} from "./network-address";
import type { ProviderHostnameResolver } from "./types";

export class UnsafeProviderUrlError extends Error {
  constructor() {
    super("The provider endpoint is not allowed.");
    this.name = "UnsafeProviderUrlError";
  }
}

export const defaultProviderHostnameResolver: ProviderHostnameResolver =
  async (hostname) => {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map(({ address }): ResolvedAddress => ({ address }));
  };

function normalizedHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export async function buildSafeChatCompletionsUrl(
  rawBaseUrl: string,
  resolveHostname: ProviderHostnameResolver = defaultProviderHostnameResolver,
): Promise<URL> {
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl.trim());
  } catch {
    throw new UnsafeProviderUrlError();
  }

  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username !== "" ||
    baseUrl.password !== "" ||
    baseUrl.search !== "" ||
    baseUrl.hash !== ""
  ) {
    throw new UnsafeProviderUrlError();
  }

  const hostname = normalizedHostname(baseUrl);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new UnsafeProviderUrlError();
  }

  if (isIP(hostname) !== 0) {
    if (!isPublicProviderAddress(hostname)) throw new UnsafeProviderUrlError();
  } else {
    const addresses = await resolveHostname(hostname);
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => !isPublicProviderAddress(address))
    ) {
      throw new UnsafeProviderUrlError();
    }
  }

  const pathname = baseUrl.pathname.replace(/\/+$/, "");
  baseUrl.pathname = `${pathname}/chat/completions`.replace(/^$/, "/chat/completions");
  return baseUrl;
}
