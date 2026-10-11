/**
 * Session lifetime metadata and log-only policy evaluation (Stage 28 decision D-06, option A, step 1).
 *
 * This module only RECORDS and EVALUATES. It never revokes, rejects, or expires a session. A session is refused only
 * for the two existing reasons: the token is unknown, or the player logged out (revoked). The 30-day absolute and
 * 7-day idle limits are reported in the server log so that they can be checked against real data before enforcement.
 *
 * Metadata lives on the persisted player record as an OPTIONAL `session` field. Records written before this field
 * existed have no `session` field; they are never modified just to add one, and they are never invalidated for it.
 *
 * Nothing in this module reads, stores, or logs a session token, a token hash, or a creation key.
 */

export const SESSION_ABSOLUTE_LIMIT_DAYS = 30;
export const SESSION_IDLE_LIMIT_DAYS = 7;
const DAY_MS = 86_400_000;

export interface SessionMetadata {
  /** When this session's token was issued. Absent for records created before metadata existed: the true age is unknown. */
  issuedAt?: string;
  /** The last accepted authenticated request. Updated in memory, persisted with the next save. */
  lastActivityAt: string;
  /** Set when the player logs out. A revoked token is refused on resume, including after a restart. */
  revokedAt?: string;
}

export interface SessionPolicyReport {
  metadataPresent: boolean;
  revoked: boolean;
  /** null when the issue time is unknown. */
  wouldExceedAbsolute: boolean | null;
  /** null only if no activity time is known at all. */
  wouldExceedIdle: boolean | null;
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

/** Validates an optional persisted `session` field. Anything other than a well-formed object is rejected. */
export function isSessionMetadata(value: unknown): value is SessionMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!isIsoTime(record.lastActivityAt)) return false;
  if (record.issuedAt !== undefined && !isIsoTime(record.issuedAt)) return false;
  if (record.revokedAt !== undefined && !isIsoTime(record.revokedAt)) return false;
  return true;
}

export function isSessionRevoked(session: SessionMetadata | undefined): boolean {
  return session?.revokedAt !== undefined;
}

/**
 * Evaluates the log-only limits. `lastSeen` is the record's existing activity timestamp. It is used for idle time only
 * when no session metadata exists. Durations are clamped at zero, so a clock that moves backwards never reports an
 * excess.
 */
export function evaluateSessionPolicy(
  session: SessionMetadata | undefined,
  lastSeen: string,
  nowMs: number,
): SessionPolicyReport {
  const issuedMs = session?.issuedAt !== undefined ? Date.parse(session.issuedAt) : null;
  const activityText = session?.lastActivityAt ?? (isIsoTime(lastSeen) ? lastSeen : undefined);
  const activityMs = activityText !== undefined ? Date.parse(activityText) : null;
  return {
    metadataPresent: session !== undefined,
    revoked: isSessionRevoked(session),
    wouldExceedAbsolute: issuedMs === null ? null : Math.max(0, nowMs - issuedMs) > SESSION_ABSOLUTE_LIMIT_DAYS * DAY_MS,
    wouldExceedIdle: activityMs === null ? null : Math.max(0, nowMs - activityMs) > SESSION_IDLE_LIMIT_DAYS * DAY_MS,
  };
}

/** A one-line log description. It contains only booleans and the words "unknown" and "absent". */
export function describeSessionPolicy(report: SessionPolicyReport): string {
  const flag = (value: boolean | null): string => (value === null ? "unknown" : value ? "true" : "false");
  return `session policy (log-only): metadata=${report.metadataPresent ? "present" : "absent"} ` +
    `would_exceed_absolute=${flag(report.wouldExceedAbsolute)} would_exceed_idle=${flag(report.wouldExceedIdle)}`;
}
