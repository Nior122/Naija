import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Single-writer lock for the file backend (Stage 35; replaces the Stage 33 PID-and-token lock file).
 *
 * The lock is an operating-system advisory lock: `flock(2)` on the sidecar file `<world file>.lock`, taken and held by a
 * small holder process (`sh` running `flock -n`, then `cat`, which waits on a pipe from this server). Node has no
 * flock binding, so the holder is the mechanism. The kernel releases the lock when the holder exits for any reason,
 * including SIGKILL of the server (the pipe closes and `cat` exits). A lock is therefore "held" only while a live holder
 * holds it. Process IDs are not used to decide who holds the lock.
 *
 * Protocol (every participant must follow it):
 *  1. A starter spawns a holder for the lock path. The holder opens the path, takes `flock -n` on it, and checks that the
 *     open descriptor still refers to the file currently at the path. If not, the holder reports RETRY, because the
 *     lock file was removed or replaced while it was being opened.
 *  2. Only a holder that reports LOCKED owns the lock. A busy lock is REFUSED. Two starters cannot both get LOCKED for
 *     the same inode, so at most one of them proceeds.
 *  3. The owner rewrites the lock record (pid, token) and then saves. The lock file is removed only by the owner, and only
 *     while it still holds the lock, before it releases the holder.
 *  4. Saves check, through ownsLockFile(), that the holder is alive, the record carries this writer's token, and the path
 *     still refers to the inode that was locked. The check runs immediately before the rename in WorldStore.
 *
 * What this protects against, demonstrated by separate-process tests (test/file-writer-lock-races.test.mjs):
 *  - two server processes starting at the same time on one host: one is refused;
 *  - a live holder: a second start is refused, however old its lock record looks;
 *  - a dead holder (SIGKILL): the lock is free at once, so a restart needs no manual step;
 *  - a stale record left by a dead process: it is overwritten by the next owner;
 *  - a protocol-following starter that tries to take a lock while the owner's save is in progress: it is refused,
 *    so it cannot replace the lock file under the owner's save.
 *
 * What it does NOT protect against (see docs/STAGE_35_PROPERTY_MUTATION_SAFETY_AND_FILE_PERSISTENCE.md, section 6):
 *  - a process that does not follow the protocol (a manual `rm` or `mv` of the lock file, or an old build that writes
 *    the lock file without flock). A manual replacement is detected at the check before the rename, but a window of a
 *    few instructions remains between that check and the rename, and it is not closed.
 *  - two hosts sharing the world file over a network filesystem. flock semantics over NFS are not relied on here.
 *  - platforms other than Linux, which refuse the file backend at startup (no flock(1), no /proc).
 *
 * The file backend is for development and tests. Production refuses it (src/persistence/open.ts). Multi-process or
 * multi-host use needs PostgreSQL.
 */

export class WorldFileLockedError extends Error {
  readonly code = "world_file_locked";
  constructor(holderPid: number | null) {
    super(
      holderPid === null
        ? "The world file is locked by another writer that has not finished starting. Start the server again in a moment."
        : `The world file is in use by another running server process (pid ${holderPid}). Only one server process may use a world file.`,
    );
    this.name = "WorldFileLockedError";
  }
}

/** The lock file no longer holds this writer's token or inode. The store is fenced and must not save again. */
export class WorldFileLockLostError extends Error {
  readonly code = "world_file_lock_lost";
  constructor() {
    super("The world file lock is no longer held by this process. This writer is fenced and must restart before saving again.");
    this.name = "WorldFileLockLostError";
  }
}

/** The file backend's lock cannot be taken on this platform or with this environment. Startup is refused. */
export class WorldFileLockUnsupportedError extends Error {
  readonly code = "world_file_lock_unsupported";
  constructor(reason: string) {
    super(`The file backend cannot take its single-writer lock here (${reason}). Use PostgreSQL, or run the file backend on Linux with util-linux flock(1).`);
    this.name = "WorldFileLockUnsupportedError";
  }
}

/** The holder did not report a lock state in time. The lock is not taken, so the start is refused. */
export class WorldFileLockHolderError extends Error {
  readonly code = "world_file_lock_holder_failed";
  constructor(detail: string) {
    super(`The world file lock holder did not report a lock state (${detail}). The start is refused.`);
    this.name = "WorldFileLockHolderError";
  }
}

interface LockRecord {
  readonly pid: number;
  readonly token: string;
}

/** A lock file this old that cannot be parsed belongs to a process that died while writing it. */
const UNREADABLE_LOCK_STALE_MS = 10_000;
const HOLDER_REPORT_TIMEOUT_MS = 5_000;
const HOLDER_EXIT_TIMEOUT_MS = 2_000;
const ACQUIRE_ATTEMPTS = 4;

/**
 * The holder. `$1` is the lock path, `$2` the status file it reports to. The descriptor opened on fd 9 is inherited by
 * `cat`, so the lock is held until `cat` exits. `cat` exits when its stdin (a pipe from the server) closes.
 */
const HOLDER_SCRIPT = [
  "umask 077",
  'exec 9>>"$1" || { echo FAILED > "$2"; exit 1; }',
  'if ! flock -n 9; then echo REFUSED > "$2"; exit 1; fi',
  'if [ "$(stat -L -c %d:%i /proc/$$/fd/9 2>/dev/null)" != "$(stat -c %d:%i "$1" 2>/dev/null)" ]; then echo RETRY > "$2"; exit 1; fi',
  'echo LOCKED > "$2"',
  "exec cat > /dev/null",
].join("\n");

let supportChecked: string | null | undefined;

/** Null when the lock can be taken here; otherwise the reason. Checked once per process. */
function lockSupportProblem(): string | null {
  if (supportChecked !== undefined) return supportChecked;
  if (process.platform !== "linux") {
    supportChecked = `platform is ${process.platform}`;
  } else {
    const probe = spawnSync("/bin/sh", ["-c", "flock --version >/dev/null 2>&1 && stat --version >/dev/null 2>&1 && test -r /proc/self/stat"]);
    supportChecked = probe.status === 0 ? null : "flock(1), GNU stat, or /proc is missing";
  }
  return supportChecked;
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

/** True when a process with this ID exists. EPERM means it exists but belongs to another user, so it counts as alive. */
export function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrorWithCode(error, "EPERM");
  }
}

/** True while the process runs. A zombie (exited, not yet reaped) does not count. Linux only. */
function processRunning(pid: number): boolean {
  let text: string;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return false;
  }
  const state = text.slice(text.lastIndexOf(")") + 2, text.lastIndexOf(")") + 3);
  return state !== "Z" && state !== "X" && state !== "";
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function readLockFile(lockPath: string): { record: LockRecord } | { unreadable: true; ageMs: number } | null {
  let text: string;
  try {
    text = readFileSync(lockPath, "utf8");
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) return null;
    throw error;
  }
  // An empty file is the state of a lock file that was just created and has no record yet. It is not an unreadable
  // record, so it does not block the owner that just took the lock. A non-empty record that cannot be parsed still does.
  if (text.trim() === "") return null;
  try {
    const parsed = JSON.parse(text) as Partial<LockRecord>;
    if (Number.isSafeInteger(parsed.pid) && typeof parsed.token === "string" && parsed.token.length > 0) {
      return { record: { pid: parsed.pid as number, token: parsed.token } };
    }
  } catch {
    // Fall through: treated as unreadable below.
  }
  let ageMs: number;
  try {
    ageMs = Date.now() - statSync(lockPath).mtimeMs;
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) return null;
    throw error;
  }
  return { unreadable: true, ageMs };
}

type HolderOutcome = "LOCKED" | "REFUSED" | "RETRY";

interface StartedHolder {
  readonly child: ChildProcess;
  readonly outcome: HolderOutcome;
}

/** Starts a holder and waits (synchronously) for its report. A holder that reports nothing is killed and refused. */
function startHolder(lockPath: string): StartedHolder {
  const statusPath = `${lockPath}.${randomUUID()}.status`;
  const child = spawn("/bin/sh", ["-c", HOLDER_SCRIPT, "naija-writer-lock", lockPath, statusPath], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  // The holder must not keep the event loop alive by itself. Its stdin pipe is the only thing that ends it.
  child.unref();
  (child.stdin as unknown as { unref?: () => void } | null)?.unref?.();
  const deadline = Date.now() + HOLDER_REPORT_TIMEOUT_MS;
  for (;;) {
    let report: string | null = null;
    try {
      report = readFileSync(statusPath, "utf8").trim();
    } catch (error) {
      if (!isErrorWithCode(error, "ENOENT")) throw error;
    }
    if (report !== null && report.length > 0) {
      unlinkSafely(statusPath);
      if (report === "LOCKED" || report === "REFUSED" || report === "RETRY") return { child, outcome: report };
      endHolder(child);
      throw new WorldFileLockHolderError(report === "FAILED" ? "the lock file could not be opened" : `report ${report}`);
    }
    if (Date.now() > deadline) {
      unlinkSafely(statusPath);
      endHolder(child);
      throw new WorldFileLockHolderError("timed out");
    }
    sleepSync(5);
  }
}

/** Ends a holder that did not take the lock, or the holder of a lock being released. Closing stdin ends `cat`. */
function endHolder(child: ChildProcess): void {
  child.stdin?.destroy();
  if (child.pid !== undefined && processRunning(child.pid)) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

function waitForHolderExit(pid: number): void {
  const deadline = Date.now() + HOLDER_EXIT_TIMEOUT_MS;
  while (processRunning(pid) && Date.now() < deadline) sleepSync(2);
}

export class WorldFileWriterLock {
  private released = false;
  private inode = -1;

  private constructor(
    readonly lockPath: string,
    readonly token: string,
    private readonly holder: ChildProcess,
  ) {}

  /**
   * Takes the lock for a world file, or throws. Synchronous, so the caller cannot observe a half-acquired state. A
   * second acquisition in the same process is refused too: the holder's flock conflicts with any other open descriptor.
   */
  static acquire(worldFilePath: string): WorldFileWriterLock {
    const problem = lockSupportProblem();
    if (problem !== null) throw new WorldFileLockUnsupportedError(problem);
    const lockPath = `${worldFilePath}.lock`;
    // A fresh deployment has no data directory yet. The lock is taken before the first save, so create it here.
    mkdirSync(dirname(worldFilePath), { recursive: true });
    for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt += 1) {
      const started = startHolder(lockPath);
      if (started.outcome === "RETRY") continue; // The lock file was replaced while the holder was opening it.
      if (started.outcome === "REFUSED") {
        // The holder exited. Another live holder has the lock. Report its pid when the record names one.
        const existing = readLockFile(lockPath);
        throw new WorldFileLockedError(existing !== null && "record" in existing ? existing.record.pid : null);
      }
      const token = randomUUID();
      const lock = new WorldFileWriterLock(lockPath, token, started.child);
      try {
        const existing = readLockFile(lockPath);
        if (existing !== null) {
          if ("unreadable" in existing) {
            // A record that cannot be read but is recent may be a writer that is still writing it.
            if (existing.ageMs < UNREADABLE_LOCK_STALE_MS) throw new WorldFileLockedError(null);
          } else if (existing.record.pid === process.pid || processIsAlive(existing.record.pid)) {
            // The lock is free, but its record names a live process. That is an old-build or a killed-holder case:
            // refuse rather than assume the process is gone.
            throw new WorldFileLockedError(existing.record.pid);
          }
        }
        writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, token, acquired_at: new Date().toISOString() })}\n`, {
          flag: "w",
          mode: 0o600,
        });
        lock.inode = statSync(lockPath).ino;
        return lock;
      } catch (error) {
        lock.abandon();
        throw error;
      }
    }
    throw new WorldFileLockedError(null);
  }

  /**
   * True while this writer still owns the lock: the holder is running, the record carries this writer's token, and the
   * path still refers to the locked inode. A missing or foreign lock is not held. A read error is thrown, so the save is
   * refused for that save only (not fenced).
   */
  isHeld(): boolean {
    if (this.released) return false;
    return this.ownsLockFile();
  }

  private ownsLockFile(): boolean {
    if (!processRunning(this.holder.pid ?? -1)) return false;
    const current = readLockFile(this.lockPath);
    if (current === null || !("record" in current) || current.record.token !== this.token) return false;
    try {
      return statSync(this.lockPath).ino === this.inode;
    } catch (error) {
      if (isErrorWithCode(error, "ENOENT")) return false;
      throw error;
    }
  }

  /** Throws WorldFileLockLostError unless isHeld() is true. */
  assertHeld(): void {
    if (!this.isHeld()) throw new WorldFileLockLostError();
  }

  /**
   * Removes the lock file while still holding the lock (only if it still names this writer), then releases the holder.
   * Safe to call more than once. The lock file is never removed by someone who does not hold the lock.
   */
  release(): void {
    if (this.released) return;
    try {
      if (this.ownsLockFile()) unlinkSafely(this.lockPath);
    } finally {
      this.abandon();
    }
  }

  /** Releases the holder without touching the lock file (used when acquisition fails after the lock was taken). */
  private abandon(): void {
    this.released = true;
    const pid = this.holder.pid;
    endHolder(this.holder);
    if (pid !== undefined) waitForHolderExit(pid);
  }
}

function unlinkSafely(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isErrorWithCode(error, "ENOENT")) throw error;
  }
}
