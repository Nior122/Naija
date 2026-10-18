/**
 * A separate server-like process for test/file-writer-lock.test.mjs. It uses the production open path or the file
 * store, and reports each step on stdout as "@@ <STEP>" lines.
 *
 * CHILD_MODE:
 *  - "open": openWorldPersistence (the production entry point) on WORLD_FILE, then holds the world until killed.
 *  - "hold-save": a store takes the writer lock, then starts a save of minute NEW_MINUTE that stops at HOLD_PHASE
 *    (a file-write phase: "after-temp-sync" or "after-rename") and waits there until killed.
 *
 * Environment: WORLD_FILE (a temporary file the test created). The test sets NAIJA_ENV=test and the file backend.
 */

import { openWorldPersistence } from "../../dist/persistence/open.js";
import { WorldStore } from "../../dist/multiplayer/persistence.js";

const out = (line) => process.stdout.write(`@@ ${line}\n`);
const forever = () => setInterval(() => {}, 1000);
const file = process.env.WORLD_FILE;
if (!file) throw new Error("WORLD_FILE is required");

if (process.env.CHILD_MODE === "open") {
  try {
    await openWorldPersistence({ stateFile: file, log: () => {} });
    out("OPENED");
  } catch (error) {
    out(`REFUSED ${error?.code ?? error?.name} ${error?.message ?? ""}`);
    process.exit(3);
  }
  forever();
} else if (process.env.CHILD_MODE === "hold-save") {
  const phase = process.env.HOLD_PHASE;
  const store = new WorldStore(file, Date.now(), {
    fileWriteFaultHook: async (current) => {
      if (current !== phase) return;
      out(`HOLD ${current}`);
      await new Promise(() => {});
    },
  });
  store.acquireWriterLock();
  out("LOCKED");
  store.state.worldClock.minute_of_day = Number(process.env.NEW_MINUTE);
  store.saveState(store.state).then(
    () => out("SAVED"),
    (error) => out(`FAILED ${error?.message ?? error}`),
  );
  forever();
} else {
  throw new Error(`unknown CHILD_MODE ${process.env.CHILD_MODE}`);
}
