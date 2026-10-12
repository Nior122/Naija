import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Single-writer lock for the file backend (Stage 33).
 *
 * One server process may hold a world file. The lock is a sidecar file, `<world file>.lock`, created exclusively
 * (O_EXCL, via flag "wx"). It records the holder's process ID and a random token. Acquisition is refused while the
 * holder process is alive. A lock whose holder has exited (SIGKILL, power loss) is taken over.
 *
 * Every save checks the token before it writes (see WorldStore). If another process has taken the lock, the save is
 * refused, and the store is fenced for good. This is the file-backend equivalent of the PostgreSQL version check.
 *
 * What this protects against: two live server processes on the same host using the same world file. The second
 * cannot acquire the lock and cannot write.
 *
 * What it does not protect against:
 *  - Two processes on different hosts sharing the file over a network: the process-ID liveness check means nothing
 *    across hosts. Multi-host use needs PostgreSQL.
 *  - Two processes that both find the same stale lock at the same moment: each may remove and recreate the lock, so
 *    the one that writes last holds it. A save verifies the token just before its rename, so the other writer is then
 *    fenced. A small window between that check and the rename is not closed (docs/STAGE_33 section 3.5, unverified).
 *  - Process-ID reuse: a stale lock whose PID has since been reused by an unrelated live process is not taken over.
 *    The world stays locked until that lock file is removed by hand. This fails closed (no writes), not open.
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

/** The lock file no longer holds this writer's token. The store is fenced and must not save again. */
export class WorldFileLockLostError extends Error {
  readonly code = "world_file_lock_lost";
  constructor() {
    super("The world file lock is no longer held by this process. This writer is fenced and must restart before saving again.");
    this.name = "WorldFileLockLostError";
  }
}

interface LockRecord {
  readonly pid: number;
  readonly token: string;
}

/** A lock file this old that cannot be parsed belongs to a process that died while writing it. */
const UNREADABLE_LOCK_STALE_MS = 10_000;

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

function readLockFile(lockPath: string): { record: LockRecord } | { unreadable: true; ageMs: number } | null {
  let text: string;
  try {
    text = readFileSync(lockPath, "utf8");
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) return null;
    throw error;
  }
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
    // Removed by its holder after it was read: there is no lock now.
    if (isErrorWithCode(error, "ENOENT")) return null;
    throw error;
  }
  return { unreadable: true, ageMs };
}

/** Test seams for WorldFileWriterLock.acquire (Stage 34). Production code passes none. */
export interface WorldFileLockHooks {
  /** Called after a stale lock record was read and before it is removed. */
  readonly afterStaleRead?: () => void;
}

export class WorldFileWriterLock {
  private released = false;

  private constructor(
    readonly lockPath: string,
    readonly token: string,
  ) {}

  /**
   * Takes the lock for a world file, or throws WorldFileLockedError. Synchronous, so the caller cannot observe a
   * half-acquired state. A second acquisition in the same process is also refused: two stores in one process would
   * write the same file with no coordination.
   */
  static acquire(worldFilePath: string, hooks: WorldFileLockHooks = {}): WorldFileWriterLock {
    const lockPath = `${worldFilePath}.lock`;
    // A fresh deployment has no data directory yet. The lock is taken before the first save, so create it here.
    mkdirSync(dirname(worldFilePath), { recursive: true });
    // A bounded number of attempts: each one either creates the lock, finds a live holder, or removes a stale lock.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const token = randomUUID();
      try {
        writeFileSync(
          lockPath,
          `${JSON.stringify({ pid: process.pid, token, acquired_at: new Date().toISOString() })}\n`,
          { flag: "wx", mode: 0o600 },
        );
        return new WorldFileWriterLock(lockPath, token);
      } catch (error) {
        if (!isErrorWithCode(error, "EEXIST")) throw error;
      }

      const existing = readLockFile(lockPath);
      if (existing === null) continue; // Removed by its holder between the two calls: try again.
      if ("unreadable" in existing) {
        if (existing.ageMs < UNREADABLE_LOCK_STALE_MS) throw new WorldFileLockedError(null);
        unlinkSafely(lockPath);
        continue;
      }
      if (existing.record.pid === process.pid || processIsAlive(existing.record.pid)) {
        throw new WorldFileLockedError(existing.record.pid);
      }
      // The holder has exited. Remove its lock and try to create ours.
      // Test seam (Stage 34): runs between reading the stale record and removing it. Production never sets it.
      hooks.afterStaleRead?.();
      unlinkSafely(lockPath);
    }
    throw new WorldFileLockedError(null);
  }

  /** True while the lock file still holds this writer's token. A missing or foreign lock is not held. */
  isHeld(): boolean {
    if (this.released) return false;
    const current = readLockFile(this.lockPath);
    return current !== null && "record" in current && current.record.token === this.token;
  }

  /** Throws WorldFileLockLostError unless isHeld() is true. */
  assertHeld(): void {
    if (!this.isHeld()) throw new WorldFileLockLostError();
  }

  /** Removes the lock file, but only if it still holds this writer's token. Safe to call more than once. */
  release(): void {
    if (this.released) return;
    this.released = true;
    const current = readLockFile(this.lockPath);
    if (current !== null && "record" in current && current.record.token === this.token) unlinkSafely(this.lockPath);
  }
}

function unlinkSafely(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isErrorWithCode(error, "ENOENT")) throw error;
  }
}
