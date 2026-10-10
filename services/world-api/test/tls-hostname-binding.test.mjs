import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createServer as createTlsServer, connect as tlsConnect } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

/**
 * Stage 28 Task 1, TLS side. A remote database is reached by name, and the certificate is checked against that name.
 * This test shows the name check still holds when the TCP connection goes to a loopback address (the situation a DNS
 * change could create). It uses a throwaway CA and certificate in a temp directory, not the repository or /tmp/tls.
 *
 * It exercises Node's TLS layer, which pg uses for its SSL upgrade. It does not prove PostgreSQL, Neon, or production.
 */

let dir;
let serverPem;
let serverKey;
let caPem;
let server;
let port;
let skipReason = false;

before(async () => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
  } catch {
    skipReason = "openssl is not installed";
    return;
  }
  dir = mkdtempSync(join(tmpdir(), "naija-tls-binding-"));
  const run = (args) => execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
  run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=naija-test-ca"]);
  writeFileSync(join(dir, "ext.cnf"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n");
  run(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=localhost"]);
  run(["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.pem", "-days", "2", "-extfile", "ext.cnf"]);
  caPem = readFileSync(join(dir, "ca.pem"));
  serverPem = readFileSync(join(dir, "server.pem"));
  serverKey = readFileSync(join(dir, "server.key"));
  server = createTlsServer({ cert: serverPem, key: serverKey }, (socket) => {
    socket.on("error", () => undefined);
    socket.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(() => {
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Opens a TLS connection to the loopback socket, verifying against `servername`. Resolves with the outcome. */
function handshake(servername) {
  return new Promise((resolve) => {
    const socket = tlsConnect({ host: "127.0.0.1", port, servername, ca: caPem, rejectUnauthorized: true });
    socket.on("secureConnect", () => {
      const authorized = socket.authorized;
      socket.end();
      resolve({ ok: authorized, error: null });
    });
    socket.on("error", (error) => resolve({ ok: false, error: error.code }));
  });
}

test("TLS binding: a certificate that names the host verifies over a loopback address", async (t) => {
  if (skipReason) return t.skip(skipReason);
  const result = await handshake("localhost");
  assert.equal(result.ok, true, `expected verified TLS, got ${result.error}`);
});

test("TLS binding: a different name is refused even though the TCP address is loopback", async (t) => {
  if (skipReason) return t.skip(skipReason);
  const result = await handshake("db.example.test");
  assert.equal(result.ok, false);
  assert.equal(result.error, "ERR_TLS_CERT_ALTNAME_INVALID", "hostname verification must still fail");
});

test("TLS binding: the database layer keeps the name and certificate verification for remote hosts", async () => {
  const { resolveDatabasePoolConfig } = await import("../dist/database/connection.js");
  const config = await resolveDatabasePoolConfig({ host: "db.example.test", environment: "production" });
  assert.equal(config.host, "db.example.test");
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});
