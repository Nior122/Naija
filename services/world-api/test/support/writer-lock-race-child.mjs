/**
 * A separate starter process for test/file-writer-lock-races.test.mjs (Stage 35). It calls the production lock
 * acquisition (WorldFileWriterLock.acquire) on WORLD_FILE, and reports the outcome on stdout as "@@ <STEP>" lines:
 *   READY                  after the module is loaded, before it tries the lock;
 *   ACQUIRED <pid>         the lock was taken, and the process holds it until its stdin closes or it is killed;
 *   REFUSED <code> <pid>   the lock was refused (the code and the named holder pid, if any).
 * It waits for "GO" on stdin before it tries the lock, so a test can start two starters at the same moment.
 */
import { WorldFileLockedError, WorldFileWriterLock } from "../../dist/persistence/writer-lock.js";

const out = (line) => process.stdout.write(`@@ ${line}\n`);
const file = process.env.WORLD_FILE;
if (!file) throw new Error("WORLD_FILE is required");

out("READY");
process.stdin.setEncoding("utf8");
let buffered = "";
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  if (!buffered.includes("GO")) return;
  process.stdin.pause();
  try {
    WorldFileWriterLock.acquire(file);
    out(`ACQUIRED ${process.pid}`);
  } catch (error) {
    const pid = error instanceof WorldFileLockedError ? (/pid (\d+)/.exec(error.message)?.[1] ?? "none") : "none";
    out(`REFUSED ${error?.code ?? error?.name} ${pid}`);
    process.exit(0);
  }
});
// Holds the lock until the test closes stdin (a clean release is not needed here) or kills the process.
setInterval(() => {}, 1000);
