/**
 * Child process for the interruption tests. It starts a real API server over a file store, sends one
 * identity.create, and pauses the save so the parent can SIGKILL it at a known point.
 *
 *   NAIJA_CRASH_STATE_FILE  temporary state file (never data/world-state.json)
 *   NAIJA_CRASH_KEY         creation key for the request (never printed)
 *   NAIJA_CRASH_POINT       "before-commit" (pause before the write) or "after-commit" (pause after it)
 *
 * It prints only "PAUSED" once the request is at the chosen point. It never prints the key.
 */
import { WorldStore } from "../../dist/multiplayer/persistence.js";
import { FaultyStore } from "./faulty-store.mjs";
import { openPeer, startApi } from "./harness.mjs";
import { createMessage } from "./creation-fixture.mjs";

const file = process.env.NAIJA_CRASH_STATE_FILE;
const key = process.env.NAIJA_CRASH_KEY;
const point = process.env.NAIJA_CRASH_POINT;
if (!file || !key || !["before-commit", "after-commit"].includes(point)) {
  process.stderr.write("creation-crash-child: missing configuration\n");
  process.exit(2);
}

const store = new FaultyStore(new WorldStore(file, Date.now()));
if (point === "before-commit") store.holdNextWrite();
else store.holdNextWriteAfterCommit();

const started = await startApi({ worldStore: store, allowedOrigins: [], tickIntervalMs: 3_600_000 });
const peer = await openPeer(started.websocketUrl);
peer.send(createMessage(key, "Interrupted"));
// Give the request time to reach the save point, then announce it.
const reached = point === "before-commit"
  ? () => store.heldCount === 1
  : () => store.committedCount === 1;
const started_at = Date.now();
while (!reached() && Date.now() - started_at < 5000) await new Promise((resolve) => setTimeout(resolve, 5));
process.stdout.write(reached() ? "PAUSED\n" : "NOT-REACHED\n");
await new Promise(() => {});
