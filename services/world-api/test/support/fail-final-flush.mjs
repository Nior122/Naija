/**
 * Child-process preload for the shutdown exit-code audit only.
 *
 * When AUDIT_FAIL_FINAL_FLUSH=1, every file-store flush throws the real WorldStateCapacityError. The error class and
 * the shutdown path are the production ones; only the trigger is injected, because reaching the 16 MiB limit with real
 * saves takes minutes. Never loaded by the server itself.
 */
import { WorldStateCapacityError, WorldStore } from "../../dist/multiplayer/persistence.js";

if (process.env.AUDIT_FAIL_FINAL_FLUSH === "1") {
  WorldStore.prototype.flush = async function failingFlush() {
    throw new WorldStateCapacityError();
  };
}
