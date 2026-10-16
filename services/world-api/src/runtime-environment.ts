import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Runtime environment, read from NAIJA_ENV. Stage 28.
 *
 * - "production": PostgreSQL only, verified TLS only, metrics protected. Policies fail closed.
 * - "development": local work. File persistence only when PERSISTENCE_BACKEND=file is set explicitly.
 *   Plaintext PostgreSQL only to a loopback host.
 * - "test": automated tests. As development, and tests must name their own state file. The live world file
 *   (services/world-api/data/world-state.json) is refused.
 *
 * The entry point requires NAIJA_ENV. Library functions that are called without it treat the environment as
 * production, so an unset variable never enables the local-only options.
 */

export const RUNTIME_ENVIRONMENTS = ["production", "development", "test"] as const;
export type RuntimeEnvironment = (typeof RUNTIME_ENVIRONMENTS)[number];

export function readRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: { required: boolean },
): RuntimeEnvironment | undefined {
  const raw = env.NAIJA_ENV?.trim().toLowerCase();
  if (raw === undefined || raw === "") {
    if (options.required) {
      throw new Error("NAIJA_ENV must be set to production, development, or test.");
    }
    return undefined;
  }
  if ((RUNTIME_ENVIRONMENTS as readonly string[]).includes(raw)) {
    return raw as RuntimeEnvironment;
  }
  throw new Error("NAIJA_ENV must be production, development, or test.");
}

/** Environment used by library policies when NAIJA_ENV is not set: the strictest one. */
export function effectiveEnvironment(environment: RuntimeEnvironment | undefined): RuntimeEnvironment {
  return environment ?? "production";
}

/** Local-only options (plaintext to loopback, file persistence, verification opt-out) are allowed here only. */
export function isLocalEnvironment(environment: RuntimeEnvironment | undefined): boolean {
  return environment === "development" || environment === "test";
}

/** The live world file that the application uses when no state file is given. Tests must never write it. */
export const LIVE_WORLD_FILE = fileURLToPath(new URL("../data/world-state.json", import.meta.url));

/**
 * Under NAIJA_ENV=test, a world file must be given explicitly and must not be the live file.
 * Throws before any file is read or written.
 */
export function assertTestWorldFileIsolation(stateFile: string | undefined, env: NodeJS.ProcessEnv = process.env): void {
  if (readRuntimeEnvironment(env, { required: false }) !== "test") {
    return;
  }
  if (stateFile === undefined || stateFile.trim() === "") {
    throw new Error("NAIJA_ENV=test requires an explicit test world file. Tests never use the live world file.");
  }
  if (canonicalPath(stateFile) === canonicalPath(LIVE_WORLD_FILE)) {
    throw new Error("NAIJA_ENV=test refuses the live world file. Use a temporary file for tests.");
  }
}

/**
 * Resolves a path to where it really points: symlinks in the final component are followed, and the parent
 * directory is resolved through realpath. A missing path is still compared by its resolved location.
 */
export function canonicalPath(path: string, depth = 0): string {
  const absolute = resolve(path);
  try {
    if (lstatSync(absolute).isSymbolicLink() && depth < 8) {
      const target = readlinkSync(absolute);
      return canonicalPath(isAbsolute(target) ? target : resolve(dirname(absolute), target), depth + 1);
    }
  } catch {
    // Missing or unreadable: fall through and resolve the parent only.
  }
  try {
    return resolve(realpathSync(dirname(absolute)), basename(absolute));
  } catch {
    return absolute;
  }
}
