import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiServer } from "../dist/app.js";

let server;
let baseUrl;

before(async () => {
  server = createApiServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("GET /health reports that the API process is responding", async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "world-api",
  });
});

test("GET /api/v1/world describes one logical Nigeria without claiming simulation", async () => {
  const response = await fetch(`${baseUrl}/api/v1/world`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: "nigeria-main",
    name: "Nigeria",
    projectName: "Naija: One World",
    topology: "single-logical-world",
    implementationStage: 0,
    simulationImplemented: false,
  });
});

test("unknown routes return a JSON 404", async () => {
  const response = await fetch(`${baseUrl}/not-a-route`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
});

test("non-GET requests are rejected without mutating state", async () => {
  const response = await fetch(`${baseUrl}/api/v1/world`, { method: "POST" });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.deepEqual(await response.json(), { error: "method_not_allowed" });
});
