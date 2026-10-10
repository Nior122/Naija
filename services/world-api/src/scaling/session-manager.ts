/**
 * Session Management
 * 
 * Handles player sessions, reconnection, expiration, and duplicate prevention.
 * Ensures players have exactly one authoritative session at a time.
 */

import { randomUUID } from "node:crypto";

export type SessionId = string;
export type PlayerId = string;

export interface PlayerSession {
  readonly sessionId: SessionId;
  readonly playerId: PlayerId;
  readonly serverInstanceId: string;
  readonly regionId: string;
  readonly createdAt: number;
  readonly lastActivity: number;
  readonly expiresAt: number;
  readonly status: "active" | "expired" | "disconnected" | "transferred";
  readonly connectionId: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface SessionCreationRequest {
  readonly playerId: PlayerId;
  readonly serverInstanceId: string;
  readonly regionId: string;
  readonly connectionId: string;
  readonly sessionDurationMs: number;
  readonly metadata?: Record<string, unknown>;
}

export interface SessionCreationResult {
  readonly success: boolean;
  readonly session?: PlayerSession;
  readonly reason?: string;
  readonly existingSession?: {
    sessionId: SessionId;
    serverInstanceId: string;
    status: string;
  };
}

export interface SessionValidationResult {
  readonly valid: boolean;
  readonly session?: PlayerSession;
  readonly reason?: string;
}

/**
 * In-memory session registry.
 * In production, this would be backed by Redis or similar for distributed access.
 */
class SessionRegistry {
  private sessions = new Map<SessionId, PlayerSession>();
  private playerSessions = new Map<PlayerId, SessionId>();

  /**
   * Creates a new session for a player.
   * Ensures only one active session per player.
   */
  createSession(request: SessionCreationRequest): SessionCreationResult {
    const existingSessionId = this.playerSessions.get(request.playerId);
    
    if (existingSessionId) {
      const existing = this.sessions.get(existingSessionId);
      if (existing && existing.status === "active" && existing.expiresAt > Date.now()) {
        return {
          success: false,
          reason: "Player already has an active session",
          existingSession: {
            sessionId: existing.sessionId,
            serverInstanceId: existing.serverInstanceId,
            status: existing.status,
          },
        };
      }
      // Clean up expired/disconnected session
      this.playerSessions.delete(request.playerId);
      if (existing) {
        this.sessions.delete(existingSessionId);
      }
    }

    const now = Date.now();
    const session: PlayerSession = {
      sessionId: `session-${randomUUID()}`,
      playerId: request.playerId,
      serverInstanceId: request.serverInstanceId,
      regionId: request.regionId,
      createdAt: now,
      lastActivity: now,
      expiresAt: now + request.sessionDurationMs,
      status: "active",
      connectionId: request.connectionId,
      metadata: request.metadata,
    };

    this.sessions.set(session.sessionId, session);
    this.playerSessions.set(request.playerId, session.sessionId);

    console.log(
      `[SessionManager] Created session ${session.sessionId} for player ${request.playerId} ` +
      `on server ${request.serverInstanceId} in region ${request.regionId}`
    );

    return { success: true, session };
  }

  /**
   * Validates a session is still active and not expired.
   */
  validateSession(sessionId: SessionId): SessionValidationResult {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { valid: false, reason: "Session not found" };
    }

    const now = Date.now();

    if (session.status !== "active") {
      return { valid: false, reason: `Session status is ${session.status}` };
    }

    if (session.expiresAt <= now) {
      this.sessions.set(sessionId, { ...session, status: "expired" });
      this.playerSessions.delete(session.playerId);
      return { valid: false, reason: "Session has expired" };
    }

    // Update last activity
    const updatedSession = { ...session, lastActivity: now };
    this.sessions.set(sessionId, updatedSession);

    return { valid: true, session: updatedSession };
  }

  /**
   * Updates the activity timestamp for a session (heartbeat).
   */
  heartbeat(sessionId: SessionId): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") {
      return false;
    }

    const now = Date.now();
    if (session.expiresAt <= now) {
      this.sessions.set(sessionId, { ...session, status: "expired" });
      this.playerSessions.delete(session.playerId);
      return false;
    }

    this.sessions.set(sessionId, { ...session, lastActivity: now });
    return true;
  }

  /**
   * Marks a session as disconnected (e.g., network drop).
   * Allows reconnection within a grace period.
   */
  markDisconnected(sessionId: SessionId): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.sessions.set(sessionId, { ...session, status: "disconnected" });
    console.log(`[SessionManager] Session ${sessionId} marked as disconnected`);
    return true;
  }

  /**
   * Attempts to reconnect a disconnected session.
   */
  reconnectSession(sessionId: SessionId, newConnectionId: string): SessionValidationResult {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { valid: false, reason: "Session not found" };
    }

    if (session.status !== "disconnected") {
      return { valid: false, reason: `Cannot reconnect session with status ${session.status}` };
    }

    const now = Date.now();
    const gracePeriodMs = 60_000; // 1 minute grace period for reconnection
    
    if (session.lastActivity + gracePeriodMs < now) {
      this.sessions.set(sessionId, { ...session, status: "expired" });
      this.playerSessions.delete(session.playerId);
      return { valid: false, reason: "Reconnection grace period has expired" };
    }

    const reconnectedSession: PlayerSession = {
      ...session,
      status: "active",
      connectionId: newConnectionId,
      lastActivity: now,
    };

    this.sessions.set(sessionId, reconnectedSession);
    console.log(`[SessionManager] Session ${sessionId} reconnected`);

    return { valid: true, session: reconnectedSession };
  }

  /**
   * Transfers a session to a different server/region.
   * Used during cross-region player movement.
   */
  transferSession(
    sessionId: SessionId,
    newServerInstanceId: string,
    newRegionId: string
  ): SessionValidationResult {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { valid: false, reason: "Session not found" };
    }

    if (session.status !== "active") {
      return { valid: false, reason: `Cannot transfer session with status ${session.status}` };
    }

    const transferredSession: PlayerSession = {
      ...session,
      serverInstanceId: newServerInstanceId,
      regionId: newRegionId,
      status: "transferred",
    };

    // Mark old session as transferred
    this.sessions.set(sessionId, transferredSession);

    // Create new session on destination server
    const now = Date.now();
    const newSession: PlayerSession = {
      sessionId: `session-${randomUUID()}`,
      playerId: session.playerId,
      serverInstanceId: newServerInstanceId,
      regionId: newRegionId,
      createdAt: now,
      lastActivity: now,
      expiresAt: session.expiresAt, // Keep same expiration
      status: "active",
      connectionId: session.connectionId,
      metadata: session.metadata,
    };

    this.sessions.set(newSession.sessionId, newSession);
    this.playerSessions.set(session.playerId, newSession.sessionId);

    console.log(
      `[SessionManager] Transferred session ${sessionId} → ${newSession.sessionId} ` +
      `for player ${session.playerId} to server ${newServerInstanceId} region ${newRegionId}`
    );

    return { valid: true, session: newSession };
  }

  /**
   * Ends a session (logout, kick, etc.).
   */
  endSession(sessionId: SessionId): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.sessions.set(sessionId, { ...session, status: "expired" });
    this.playerSessions.delete(session.playerId);
    console.log(`[SessionManager] Session ${sessionId} ended`);
    return true;
  }

  /**
   * Gets the active session for a player.
   */
  getPlayerSession(playerId: PlayerId): PlayerSession | undefined {
    const sessionId = this.playerSessions.get(playerId);
    if (!sessionId) {
      return undefined;
    }
    return this.sessions.get(sessionId);
  }

  /**
   * Gets all active sessions on a specific server.
   */
  getSessionsOnServer(serverInstanceId: string): PlayerSession[] {
    const now = Date.now();
    return Array.from(this.sessions.values()).filter(
      (s) => s.serverInstanceId === serverInstanceId && s.status === "active" && s.expiresAt > now
    );
  }

  /**
   * Cleans up expired sessions.
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt <= now && session.status === "active") {
        this.sessions.set(sessionId, { ...session, status: "expired" });
        this.playerSessions.delete(session.playerId);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// Singleton instance
export const sessionRegistry = new SessionRegistry();

/**
 * Default session duration (1 hour).
 */
export const DEFAULT_SESSION_DURATION_MS = 60 * 60 * 1000;

/**
 * Recommended session heartbeat interval (every 30 seconds).
 */
export const RECOMMENDED_SESSION_HEARTBEAT_MS = 30_000;
