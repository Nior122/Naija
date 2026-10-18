import type { HealthCheck } from "./monitoring.js";

/**
 * Save outcome tracking (Stage 28, G1). A store records the outcome of every save it performs. The health check
 * reports the outcome of the most recent attempt, so a running process cannot report healthy persistence while saves
 * are being refused or failing.
 *
 * A failing state is closed only by a save that actually succeeded. Connection checks, retries, and timers do not
 * close it. Only reason codes and timestamps are kept. No world data, credentials, or error text is stored.
 */

export type SaveFailureReason = "capacity" | "conflict" | "error";

export interface SaveStatus {
  /** not_attempted: no save since start. saved: the last attempt succeeded. failing: the last attempt failed. */
  readonly state: "not_attempted" | "saved" | "failing";
  readonly consecutiveFailures: number;
  /** Number of separate failing periods since start (a period starts at the first failure after a success). */
  readonly failureEpisodes: number;
  readonly lastSuccessAt: string | null;
  readonly failingSince: string | null;
  readonly lastFailureReason: SaveFailureReason | null;
}

/** Classifies a save error by its error name only, so no message text is inspected or kept. */
export function classifySaveFailure(error: unknown): SaveFailureReason {
  const name = error instanceof Error ? error.name : "";
  if (name === "WorldStateCapacityError") return "capacity";
  if (name === "WorldStateConflictError" || name === "WorldFileLockLostError") return "conflict";
  return "error";
}

/**
 * What a failed save tells us about the storage (Stage 33). The engine uses it to answer a financial request truthfully.
 *
 * - not_saved: the failure happened before the new world could become visible. The storage holds the previous world,
 *   so the change is certainly not saved. A retry is a new attempt.
 * - unknown: the failure happened after the new world may have become visible (for example, after a rename, or after a
 *   database commit whose reply was lost). The change may be saved. A retry must use the same request ID, which then
 *   returns the recorded result instead of applying the change again.
 *
 * A failure that was not classified is treated as unknown: that is the safe reading.
 */
export type SaveOutcome = "not_saved" | "unknown";

const saveOutcomes = new WeakMap<object, SaveOutcome>();

/** Records the outcome on an error object and returns the same error, so the throw site stays unchanged. */
export function markSaveOutcome<T>(error: T, outcome: SaveOutcome): T {
  if (typeof error === "object" && error !== null) saveOutcomes.set(error, outcome);
  return error;
}

export function saveOutcomeOf(error: unknown): SaveOutcome {
  if (typeof error === "object" && error !== null) return saveOutcomes.get(error) ?? "unknown";
  return "unknown";
}

const REASON_TEXT: Record<SaveFailureReason, string> = {
  capacity: "the world is over its size limit",
  conflict: "this instance was superseded by another writer and must restart",
  error: "the storage write failed",
};

export class SaveStatusTracker {
  private state: SaveStatus = {
    state: "not_attempted",
    consecutiveFailures: 0,
    failureEpisodes: 0,
    lastSuccessAt: null,
    failingSince: null,
    lastFailureReason: null,
  };

  recordSuccess(now: number): void {
    this.state = {
      ...this.state,
      state: "saved",
      consecutiveFailures: 0,
      lastSuccessAt: new Date(now).toISOString(),
      failingSince: null,
    };
  }

  recordFailure(reason: SaveFailureReason, now: number): void {
    const startsEpisode = this.state.state !== "failing";
    this.state = {
      ...this.state,
      state: "failing",
      consecutiveFailures: this.state.consecutiveFailures + 1,
      failureEpisodes: this.state.failureEpisodes + (startsEpisode ? 1 : 0),
      failingSince: startsEpisode ? new Date(now).toISOString() : this.state.failingSince,
      lastFailureReason: reason,
    };
  }

  snapshot(): SaveStatus {
    return { ...this.state };
  }

  /** The health check for save outcomes alone. A store may add its own checks (reachability, fencing) to it. */
  check(): HealthCheck {
    const status = this.state;
    if (status.state === "not_attempted") {
      return { status: "pass", message: "No world save has been attempted since start." };
    }
    if (status.state === "saved") {
      return { status: "pass", message: `Last world save succeeded at ${status.lastSuccessAt}.` };
    }
    const reason = status.lastFailureReason ?? "error";
    return {
      status: "fail",
      message:
        `World saves are failing since ${status.failingSince} (${REASON_TEXT[reason]}; ` +
        `${status.consecutiveFailures} consecutive attempts). Changes made since the last successful save are not persisted.`,
    };
  }
}
