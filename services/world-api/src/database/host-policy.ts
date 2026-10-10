import { BlockList, isIP } from "node:net";
import { promises as dnsPromises, type LookupAddress } from "node:dns";

/**
 * Host policy for plaintext PostgreSQL connections (DB_SSL=false). Stage 28.
 *
 * Plaintext is allowed only to a host that is provably on this machine:
 * - IPv4 127.0.0.0/8, IPv6 ::1, and IPv4-mapped IPv6 127.0.0.0/8 (::ffff:127.x.x.x), as IP literals;
 * - the name "localhost", but only when DNS (checked at connect time) returns loopback addresses and nothing else.
 * Everything else is refused: other names, other addresses, unix sockets, multiple hosts, and an empty host.
 *
 * Errors name the rule, never the connection string, the user, or the password.
 */

export class HostPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostPolicyError";
  }
}

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");
LOOPBACK.addSubnet("::ffff:127.0.0.0", 104, "ipv6");

export type LookupFunction = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;

const defaultLookup: LookupFunction = (hostname, options) => dnsPromises.lookup(hostname, options);

/** Strips brackets around IPv6 literals, a trailing dot, and case. */
export function normalizeHostName(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  if (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  return host;
}

export function isLoopbackAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) {
    return false;
  }
  return LOOPBACK.check(address, version === 4 ? "ipv4" : "ipv6");
}

export type PlaintextHostClass = "loopback-address" | "localhost-name";

/** Synchronous check of the configured host. Returns the class of host, or throws HostPolicyError. */
export function classifyPlaintextHost(rawHost: string | undefined): PlaintextHostClass {
  if (rawHost === undefined || rawHost.trim() === "") {
    throw new HostPolicyError("DB_SSL=false requires an explicit loopback host. No host is configured.");
  }
  if (rawHost.startsWith("/") || rawHost.toLowerCase().includes("%2f")) {
    throw new HostPolicyError("DB_SSL=false does not support unix socket hosts. Use a loopback TCP host.");
  }
  if (rawHost.includes(",")) {
    throw new HostPolicyError("DB_SSL=false does not support multiple hosts. Use a single loopback host.");
  }
  const host = normalizeHostName(rawHost);
  if (isIP(host) !== 0) {
    if (isLoopbackAddress(host)) {
      return "loopback-address";
    }
    throw new HostPolicyError(
      "DB_SSL=false is refused: the database host is not a loopback address (127.0.0.0/8 or ::1).",
    );
  }
  if (host === "localhost") {
    return "localhost-name";
  }
  throw new HostPolicyError(
    "DB_SSL=false is refused: the database host is not localhost or a loopback address. Remote databases require TLS.",
  );
}

/**
 * Connect-time resolution for plaintext. Returns the exact addresses the connection may use.
 *
 * - An IP literal resolves to itself. No DNS is involved.
 * - "localhost" is resolved ONCE, here. Every answer must be loopback; a lookup failure, an empty answer, or any
 *   non-loopback answer refuses the connection. The returned list is the only set of addresses the pool may use
 *   (see pinnedPlaintextStream in connection.ts), so a later DNS change cannot redirect a plaintext connection.
 */
export async function resolvePlaintextAddresses(
  rawHost: string | undefined,
  lookup: LookupFunction = defaultLookup,
): Promise<LookupAddress[]> {
  const kind = classifyPlaintextHost(rawHost);
  if (kind === "loopback-address") {
    const address = normalizeHostName(rawHost ?? "");
    return [{ address, family: isIP(address) }];
  }
  let answers: LookupAddress[];
  try {
    answers = await lookup("localhost", { all: true, verbatim: true });
  } catch {
    throw new HostPolicyError("DB_SSL=false is refused: localhost could not be resolved to loopback addresses.");
  }
  if (answers.length === 0 || !answers.every((entry) => isLoopbackAddress(entry.address))) {
    throw new HostPolicyError(
      "DB_SSL=false is refused: localhost resolves to a non-loopback address on this machine.",
    );
  }
  return answers.map((entry) => ({ address: entry.address, family: entry.family }));
}

/** Connect-time check for callers that only need the verdict. See resolvePlaintextAddresses. */
export async function assertPlaintextHostIsLoopback(
  rawHost: string | undefined,
  lookup: LookupFunction = defaultLookup,
): Promise<void> {
  await resolvePlaintextAddresses(rawHost, lookup);
}
