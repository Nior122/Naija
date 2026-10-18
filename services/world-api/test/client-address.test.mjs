import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTrustedProxies, resolveClientAddress } from "../dist/client-address.js";

/**
 * Client address for R4 (approved design, docs/STAGE_28_IDENTITY_BUDGET.md section "Client address").
 * X-Forwarded-For is read only when the socket's own address is listed in NAIJA_TRUSTED_PROXIES. The default
 * lists nothing, so the header is ignored. A spoofed leftmost entry is never used.
 */

const none = parseTrustedProxies(undefined);
const loopbackProxy = parseTrustedProxies("127.0.0.1");

test("trusted proxies: the default trusts nothing, so X-Forwarded-For is ignored", () => {
  assert.equal(resolveClientAddress("203.0.113.9", "198.51.100.1", none), "203.0.113.9");
  assert.equal(resolveClientAddress("127.0.0.1", "198.51.100.1", none), "127.0.0.1");
});

test("trusted proxies: a header from an untrusted socket is ignored even when it names a trusted address", () => {
  assert.equal(resolveClientAddress("203.0.113.9", "127.0.0.1", loopbackProxy), "203.0.113.9");
});

test("trusted proxies: a trusted socket's forwarded client is used", () => {
  assert.equal(resolveClientAddress("127.0.0.1", "198.51.100.1", loopbackProxy), "198.51.100.1");
});

test("trusted proxies: a spoofed leftmost entry is ignored; the entry added by the trusted proxy is used", () => {
  assert.equal(resolveClientAddress("127.0.0.1", "1.1.1.1, 198.51.100.3", loopbackProxy), "198.51.100.3");
  assert.equal(resolveClientAddress("127.0.0.1", "10.9.9.9, 198.51.100.4", parseTrustedProxies("127.0.0.1, 10.0.0.0/8")), "198.51.100.4");
});

test("trusted proxies: a chain of trusted hops is walked from the right to the first untrusted address", () => {
  const policy = parseTrustedProxies("127.0.0.1, 10.0.0.0/8");
  assert.equal(resolveClientAddress("10.0.0.3", "203.0.113.7, 10.0.0.2", policy), "203.0.113.7");
});

test("trusted proxies: an IPv4-mapped IPv6 socket address matches an IPv4 entry", () => {
  assert.equal(resolveClientAddress("::ffff:127.0.0.1", "198.51.100.5", loopbackProxy), "198.51.100.5");
});

test("trusted proxies: IPv6 addresses and CIDR ranges are supported", () => {
  const policy = parseTrustedProxies("2001:db8::/32");
  assert.equal(resolveClientAddress("2001:db8::5", "2001:db8:1::9", policy), "2001:db8:1::9");
  assert.equal(resolveClientAddress("2001:db9::5", "2001:db8:1::9", policy), "2001:db9::5", "outside the range is untrusted");
});

test("trusted proxies: a malformed forwarded entry makes the server use the socket address", () => {
  assert.equal(resolveClientAddress("127.0.0.1", "not-an-address, 198.51.100.1", loopbackProxy), "127.0.0.1");
  assert.equal(resolveClientAddress("127.0.0.1", "198.51.100.1:443", loopbackProxy), "127.0.0.1");
});

test("trusted proxies: an empty, oversized or too-long chain is ignored", () => {
  assert.equal(resolveClientAddress("127.0.0.1", "", loopbackProxy), "127.0.0.1");
  assert.equal(resolveClientAddress("127.0.0.1", "   ", loopbackProxy), "127.0.0.1");
  const tooMany = Array.from({ length: 9 }, (_, i) => `198.51.100.${i + 1}`).join(", ");
  assert.equal(resolveClientAddress("127.0.0.1", tooMany, loopbackProxy), "127.0.0.1");
  const tooLong = `198.51.100.1${" ".repeat(600)}`;
  assert.equal(resolveClientAddress("127.0.0.1", tooLong, loopbackProxy), "127.0.0.1");
});

test("trusted proxies: repeated X-Forwarded-For header lines are joined and walked the same way", () => {
  assert.equal(resolveClientAddress("127.0.0.1", ["1.1.1.1", "198.51.100.6"], loopbackProxy), "198.51.100.6");
});

test("trusted proxies: a missing socket address is reported as unknown, never as an empty string", () => {
  assert.equal(resolveClientAddress(undefined, undefined, none), "unknown");
});

test("trusted proxies: configuration accepts lists and rejects invalid entries without echoing them", () => {
  assert.equal(parseTrustedProxies("").entries, 0);
  assert.equal(parseTrustedProxies("  ").entries, 0);
  assert.equal(parseTrustedProxies("127.0.0.1, 10.0.0.0/8 ,::1").entries, 3);
  for (const bad of ["10.0.0.0/33", "300.1.1.1", "secret-host.internal", "2001:db8::/129", "10.0.0.1,,"]) {
    assert.throws(
      () => parseTrustedProxies(bad),
      (error) => {
        assert.equal(error.message, "NAIJA_TRUSTED_PROXIES must be a comma-separated list of IP addresses or CIDR ranges.");
        assert.ok(!error.message.includes(bad));
        return true;
      },
      bad,
    );
  }
});
