import { createHash } from "node:crypto";

/**
 * Durable request records (Stage 36).
 *
 * A consequential request (a money command or a property action) that changes the world is recorded with a fingerprint
 * of what it asked for. The record is stored in the same transaction as the world update that applied it, so every
 * process that loads the world can tell whether a request ID was already applied, and whether a reused ID asks for the
 * same thing. The fingerprint is a SHA-256 hash: it does not contain the request payload.
 */

/** How long a durable record is kept. Records older than this are pruned during saves. A retry after pruning is a new request. */
export const OPERATION_RECORD_RETENTION_DAYS = 90;

/** A record for a request that the engine has applied (or is about to commit with the save that follows). */
export interface OperationRecord {
  playerId: string;
  requestId: string;
  command: string;
  fingerprint: string;
}

/** A durable record as read back from storage. */
export interface StoredOperation {
  command: string;
  fingerprint: string;
  worldVersion: number;
}

/** Stable JSON: object keys are sorted at every level, so equal content has equal text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The fingerprint of a request: its command and its body, without the request ID. The caller passes the body with any
 * per-attempt fields removed (for example the request ID and the type), so a retry of the same request has the same
 * fingerprint.
 */
export function requestFingerprint(command: string, body: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson({ command, body })).digest("hex");
}

/** The fingerprint of a property request: its action and payload (the Stage 35 scheme, unchanged). */
export function propertyRequestFingerprint(action: string, payload: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson({ action, payload })).digest("hex");
}

/** Outcome of comparing a request with the record of an earlier request that used the same ID. */
export type PriorRequestVerdict = "new" | "duplicate" | "reused";

/**
 * Compare a request with an earlier record for the same ID. Same command and fingerprint: a duplicate, to be answered
 * without applying it again. Anything else: the ID was reused for a different request, and it is refused.
 */
export function compareWithRecord(
  record: { command: string; fingerprint: string },
  command: string,
  fingerprint: string,
): PriorRequestVerdict {
  return record.command === command && record.fingerprint === fingerprint ? "duplicate" : "reused";
}
