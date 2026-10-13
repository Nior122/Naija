/**
 * A stand-in for a server in file-writer-lock-races.test.mjs (Stage 44). It takes the world-file lock with the
 * production acquisition (WorldFileWriterLock.acquire) on WORLD_FILE, reports the pid of the lock holder process it
 * started, and then waits. It exits when its stdin receives "QUIT" (a normal exit, with no release call). A test can
 * also kill it, which is the other way a server ends.
 *   HOLDER <pid>   the lock was taken; the holder is the child process that keeps the lock.
 */
import { WorldFileWriterLock } from "../../dist/persistence/writer-lock.js";

const file = process.env.WORLD_FILE;
if (!file) throw new Error("WORLD_FILE is required");

const lock = WorldFileWriterLock.acquire(file);
process.stdout.write(`HOLDER ${lock.holder.pid}\n`);

process.stdin.setEncoding("utf8");
let buffered = "";
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  if (buffered.includes("QUIT")) process.exit(0);
});
setInterval(() => {}, 1000);
