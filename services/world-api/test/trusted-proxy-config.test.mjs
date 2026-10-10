import assert from "node:assert/strict";
import { test } from "node:test";
import { readApiConfig } from "../dist/config.js";

/** A fixed environment, so the result does not depend on the shell that runs the tests. */
const base = { NAIJA_ENV: "test", PERSISTENCE_BACKEND: "file" };

/** NAIJA_TRUSTED_PROXIES reaches the config as a policy; the default trusts nothing. */

test("trusted proxies config: the default trusts no proxy", () => {
  const config = readApiConfig({ ...base, NAIJA_TRUSTED_PROXIES: "" });
  assert.equal(config.trustedProxies.entries, 0);
  assert.equal(config.trustedProxies.trusts("127.0.0.1"), false);
});

test("trusted proxies config: a listed address is trusted and nothing else is", () => {
  const config = readApiConfig({ ...base, NAIJA_TRUSTED_PROXIES: "127.0.0.1, 10.0.0.0/8" });
  assert.equal(config.trustedProxies.entries, 2);
  assert.equal(config.trustedProxies.trusts("127.0.0.1"), true);
  assert.equal(config.trustedProxies.trusts("10.1.2.3"), true);
  assert.equal(config.trustedProxies.trusts("203.0.113.5"), false);
});

test("trusted proxies config: an invalid value stops startup without echoing it", () => {
  assert.throws(
    () => readApiConfig({ ...base, NAIJA_TRUSTED_PROXIES: "10.0.0.0/99,leaked-host.example" }),
    (error) => {
      assert.equal(error.message, "NAIJA_TRUSTED_PROXIES must be a comma-separated list of IP addresses or CIDR ranges.");
      assert.ok(!error.message.includes("leaked-host"));
      return true;
    },
  );
});
