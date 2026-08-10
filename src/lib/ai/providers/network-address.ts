import { isIP } from "node:net";

export type ResolvedAddress = Readonly<{ address: string }>;

function parseIpv4(address: string): readonly number[] | null {
  const octets = address.split(".");
  if (octets.length !== 4) return null;

  const parsed = octets.map((octet) => Number(octet));
  return parsed.every(
    (octet, index) =>
      Number.isInteger(octet) &&
      octet >= 0 &&
      octet <= 255 &&
      String(octet) === octets[index],
  )
    ? parsed
    : null;
}

function isPublicIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const [a, b, c] = octets;

  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function expandIpv6(address: string): readonly number[] | null {
  const zoneIndex = address.indexOf("%");
  const withoutZone = zoneIndex === -1 ? address : address.slice(0, zoneIndex);
  const embeddedIpv4Index = withoutZone.lastIndexOf(":");
  let normalized = withoutZone;

  if (withoutZone.includes(".")) {
    const ipv4 = parseIpv4(withoutZone.slice(embeddedIpv4Index + 1));
    if (!ipv4) return null;
    const high = (ipv4[0] << 8) | ipv4[1];
    const low = (ipv4[2] << 8) | ipv4[3];
    normalized = `${withoutZone.slice(0, embeddedIpv4Index)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;

  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ].map((group) => Number.parseInt(group, 16));

  return groups.length === 8 &&
    groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

function isPublicIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups) return false;

  const [first, second, third, fourth, , sixth, seventh, eighth] = groups;
  const isUnspecified = groups.every((group) => group === 0);
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && eighth === 1;
  const isMappedIpv4 = groups.slice(0, 5).every((group) => group === 0) && sixth === 0xffff;

  if (isMappedIpv4) {
    return isPublicIpv4(
      `${seventh >> 8}.${seventh & 0xff}.${eighth >> 8}.${eighth & 0xff}`,
    );
  }

  return !(
    isUnspecified ||
    isLoopback ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x0100 && second === 0 && third === 0 && fourth === 0) ||
    (first === 0x2001 && second === 0x0db8)
  ) && (first & 0xe000) === 0x2000;
}

export function isPublicProviderAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}
