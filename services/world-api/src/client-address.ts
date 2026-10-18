import { BlockList, isIP } from "node:net";

/**
 * Client address for the R4 identity budget and connection limits.
 *
 * The socket's own address is the only trusted source by default. X-Forwarded-For is read only when the socket
 * address is listed in NAIJA_TRUSTED_PROXIES (IP addresses or CIDR ranges). The header is then walked from the
 * right: each hop that is itself a trusted proxy is skipped, and the first other address is the client. Entries to
 * the left of that point were written by the client or by an untrusted hop and are never used. A malformed or
 * oversized header is ignored, so the socket address is used.
 *
 * Deployment requirement: the proxy must append the address it received to X-Forwarded-For (and must not pass a
 * client's header through unchanged). See docs/STAGE_28_IDENTITY_BUDGET.md.
 */

const MAX_FORWARDED_HEADER_LENGTH = 512;
const MAX_FORWARDED_HOPS = 8;
const CONFIG_ERROR = "NAIJA_TRUSTED_PROXIES must be a comma-separated list of IP addresses or CIDR ranges.";

export interface TrustedProxies {
  /** Number of configured entries (addresses and ranges). Zero means no header is trusted. */
  readonly entries: number;
  /** True when the (already normalized) address is a configured trusted proxy. */
  trusts(address: string): boolean;
}

/** Strips the IPv4-mapped IPv6 prefix and lower-cases, so 127.0.0.1 and ::ffff:127.0.0.1 compare equal. */
function normalizeAddress(address: string): string {
  const trimmed = address.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(trimmed);
  return mapped?.[1] ?? trimmed;
}

function addressFamily(address: string): 4 | 6 | 0 {
  const family = isIP(address);
  return family === 4 || family === 6 ? family : 0;
}

/** Parses NAIJA_TRUSTED_PROXIES. Empty or missing means no trusted proxies. Invalid input stops startup without echoing it. */
export function parseTrustedProxies(raw: string | undefined): TrustedProxies {
  const blockList = new BlockList();
  if (raw === undefined || raw.trim() === "") {
    return { entries: 0, trusts: () => false };
  }
  const parts = raw.split(",").map((part) => part.trim());
  for (const part of parts) {
    const [addressPart = "", prefixPart, extra] = part.split("/");
    if (extra !== undefined || addressPart === "") throw new Error(CONFIG_ERROR);
    const address = normalizeAddress(addressPart);
    const family = addressFamily(address);
    if (family === 0) throw new Error(CONFIG_ERROR);
    if (prefixPart === undefined) {
      blockList.addAddress(address, family === 4 ? "ipv4" : "ipv6");
    } else {
      const prefix = Number(prefixPart);
      const maxPrefix = family === 4 ? 32 : 128;
      if (!/^\d{1,3}$/.test(prefixPart) || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
        throw new Error(CONFIG_ERROR);
      }
      blockList.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
    }
  }
  return {
    entries: parts.length,
    trusts(candidate: string): boolean {
      const normalized = normalizeAddress(candidate);
      const family = addressFamily(normalized);
      if (family === 0) return false;
      return blockList.check(normalized, family === 4 ? "ipv4" : "ipv6");
    },
  };
}

/**
 * The address to use for limits. `socketAddress` is request.socket.remoteAddress. `forwardedFor` is the
 * X-Forwarded-For header value (Node joins repeated lines into an array).
 */
export function resolveClientAddress(
  socketAddress: string | undefined,
  forwardedFor: string | readonly string[] | undefined,
  trusted: TrustedProxies,
): string {
  if (socketAddress === undefined || socketAddress.trim() === "") return "unknown";
  const socket = normalizeAddress(socketAddress);
  if (trusted.entries === 0 || !trusted.trusts(socket)) return socket;

  const header = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
  if (typeof header !== "string" || header.length > MAX_FORWARDED_HEADER_LENGTH) return socket;
  const hops = header.split(",").map((hop) => normalizeAddress(hop));
  if (hops.length === 0 || hops.length > MAX_FORWARDED_HOPS) return socket;
  if (!hops.every((hop) => addressFamily(hop) !== 0)) return socket;

  // hops = [client-claimed, ..., last proxy seen]; the socket is the proxy that connected to us.
  const chain = [...hops, socket];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const hop = chain[index];
    if (hop !== undefined && !trusted.trusts(hop)) return hop;
  }
  // Every hop is a trusted proxy: the request came entirely from internal infrastructure. Use the leftmost entry.
  return chain[0] ?? socket;
}
