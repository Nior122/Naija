/*
 * Capacity baseline driver (Stage 28). Runs against a built tree given by TREE_ROOT, so the same measurement can be
 * made on an older commit (extract it with `git archive <commit> | tar -x -C <dir>`, link node_modules, and run
 * `tsc -p tsconfig.json` in its services/world-api). It creates identities over real sockets, one socket each, until the
 * first failed creation, then shuts down and writes OUT. It uses a temporary directory and never reads or writes a
 * live world file. Not for live data.
 *
 * Environment: TREE_ROOT, OUT, TARGET (default 3000), PROFILE_JSON (the creation profile as JSON).
 */
import { createRequire } from "node:module";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

const treeRoot = process.env.TREE_ROOT;
const require = createRequire(join(treeRoot, "package.json"));
const WebSocket = require("ws");
const { createApiServer } = await import(join(treeRoot, "dist/app.js"));
const out = process.env.OUT;
const target = Number(process.env.TARGET ?? 3000);

const dir = mkdtempSync(join(tmpdir(), "naija-629-"));
const stateFile = join(dir, "world-state.json");
const server = createApiServer({ stateFile, allowedOrigins: [], tickIntervalMs: 3_600_000, connectionAttemptsPerMinute: 1_000_000_000 });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `ws://127.0.0.1:${port}/ws`;

const profile = JSON.parse(process.env.PROFILE_JSON);
function createOnce(name) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("timeout")), 60_000);
    socket.on("error", (e) => { clearTimeout(timer); reject(e); });
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "identity.create", creationKey: randomBytes(32).toString("hex"), profile: { ...profile, name } }));
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== "identity.created" && message.type !== "error") return;
      clearTimeout(timer);
      socket.close();
      resolve(message);
    });
  });
}

const report = { tree: treeRoot, target, created: 0, firstFailure: null, samples: [], shutdown: null };
const started = performance.now();
for (let i = 1; i <= target; i += 1) {
  const reply = await createOnce(`Driver ${i}`);
  if (reply.type === "error") {
    report.firstFailure = { attempt: i, code: reply.code };
    break;
  }
  report.created = i;
  if (i % 50 === 0) report.samples.push({ identities: i, bytes: statSync(stateFile).size, elapsedSeconds: Math.round((performance.now() - started) / 1000) });
}
report.creationSeconds = Math.round((performance.now() - started) / 1000);
report.finalFileBytes = statSync(stateFile).size;
const shutdownStarted = performance.now();
try {
  await server.shutdown();
  report.shutdown = { ok: true, ms: Math.round(performance.now() - shutdownStarted) };
} catch (error) {
  report.shutdown = { ok: false, error: error instanceof Error ? error.message : "error", ms: Math.round(performance.now() - shutdownStarted) };
}
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ created: report.created, firstFailure: report.firstFailure, bytes: report.finalFileBytes, shutdown: report.shutdown }));
process.exit(0);
