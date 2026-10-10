/**
 * Cross-Region Player Movement
 * 
 * Manages player transitions between different geographic regions.
 * Ensures atomic state transfer and prevents duplicate sessions.
 */

import { randomUUID } from "node:crypto";
import { regionOwnershipRegistry, type RegionId, type ServerInstanceId } from "./region-ownership.js";
import { sessionRegistry, type SessionId, type PlayerId } from "./session-manager.js";

export type TransitionId = string;

export type TransitionStatus = 
  | "initiated"
  | "validating"
  | "saving_state"
  | "transferring"
  | "completing"
  | "completed"
  | "failed"
  | "rolled_back";

export interface RegionTransition {
  readonly transitionId: TransitionId;
  readonly playerId: PlayerId;
  readonly sourceRegionId: RegionId;
  readonly destinationRegionId: RegionId;
  readonly sourceServerInstanceId: ServerInstanceId;
  readonly destinationServerInstanceId: ServerInstanceId;
  readonly sourceSessionId: SessionId;
  readonly status: TransitionStatus;
  readonly initiatedAt: number;
  readonly completedAt?: number;
  readonly failedAt?: number;
  readonly failureReason?: string;
  readonly playerState?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface TransitionRequest {
  readonly playerId: PlayerId;
  readonly sourceSessionId: SessionId;
  readonly sourceRegionId: RegionId;
  readonly destinationRegionId: RegionId;
  readonly destinationServerInstanceId: ServerInstanceId;
  readonly playerState: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export interface TransitionResult {
  readonly success: boolean;
  readonly transition?: RegionTransition;
  readonly newSessionId?: SessionId | undefined;
  readonly reason?: string | undefined;
}

export interface TransitionValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/**
 * In-memory transition registry.
 * In production, this would be backed by a distributed database with transactions.
 */
class TransitionManager {
  private transitions = new Map<TransitionId, RegionTransition>();
  private activePlayerTransitions = new Map<PlayerId, TransitionId>();

  /**
   * Initiates a cross-region transition for a player.
   * This is a multi-step process that ensures atomicity.
   */
  async initiateTransition(request: TransitionRequest): Promise<TransitionResult> {
    // Check if player is already in a transition
    const existingTransitionId = this.activePlayerTransitions.get(request.playerId);
    if (existingTransitionId) {
      const existing = this.transitions.get(existingTransitionId);
      if (existing && (existing.status === "initiated" || existing.status === "validating" || 
          existing.status === "saving_state" || existing.status === "transferring")) {
        return {
          success: false,
          reason: "Player is already in an active transition",
        };
      }
    }

    // Validate the transition
    const validation = this.validateTransitionRequest(request);
    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }

    const transitionId = `transition-${randomUUID()}`;
    const now = Date.now();

    // Extract server instance ID from session ID (format: session-{serverId}-{uuid})
    const sessionParts = request.sourceSessionId.split("-");
    const sourceServerInstanceId = sessionParts[1] ?? "unknown";

    const transition: RegionTransition = {
      transitionId,
      playerId: request.playerId,
      sourceRegionId: request.sourceRegionId,
      destinationRegionId: request.destinationRegionId,
      sourceServerInstanceId,
      destinationServerInstanceId: request.destinationServerInstanceId,
      sourceSessionId: request.sourceSessionId,
      status: "initiated",
      initiatedAt: now,
      playerState: request.playerState,
      metadata: request.metadata,
    };

    this.transitions.set(transitionId, transition);
    this.activePlayerTransitions.set(request.playerId, transitionId);

    console.log(
      `[TransitionManager] Initiated transition ${transitionId} for player ${request.playerId} ` +
      `from ${request.sourceRegionId} to ${request.destinationRegionId}`
    );

    // Execute the transition steps
    try {
      await this.executeTransition(transitionId);
      const completedTransition = this.transitions.get(transitionId)!;
      const newSessionId = this.getNewSessionId(transitionId);
      
      return {
        success: true,
        transition: completedTransition,
        newSessionId,
      };
    } catch (error) {
      const failedTransition = this.transitions.get(transitionId)!;
      return {
        success: false,
        transition: failedTransition,
        reason: failedTransition.failureReason,
      };
    }
  }

  /**
   * Validates a transition request.
   */
  private validateTransitionRequest(request: TransitionRequest): TransitionValidationResult {
    // Validate source session
    const sourceSessionValidation = sessionRegistry.validateSession(request.sourceSessionId);
    if (!sourceSessionValidation.valid) {
      return {
        valid: false,
        reason: `Source session is invalid: ${sourceSessionValidation.reason}`,
      };
    }

    // Validate source session belongs to the player
    if (sourceSessionValidation.session!.playerId !== request.playerId) {
      return {
        valid: false,
        reason: "Source session does not belong to the specified player",
      };
    }

    // Validate source session is in the source region
    if (sourceSessionValidation.session!.regionId !== request.sourceRegionId) {
      return {
        valid: false,
        reason: "Source session is not in the specified source region",
      };
    }

    // Validate destination region has an owner
    const destOwnership = regionOwnershipRegistry.getOwnership(request.destinationRegionId);
    if (!destOwnership || destOwnership.status !== "active") {
      return {
        valid: false,
        reason: "Destination region has no active owner",
      };
    }

    // Validate destination server matches region owner
    if (destOwnership.ownerInstanceId !== request.destinationServerInstanceId) {
      return {
        valid: false,
        reason: "Destination server does not own the destination region",
      };
    }

    // Validate player state is provided
    if (!request.playerState || Object.keys(request.playerState).length === 0) {
      return {
        valid: false,
        reason: "Player state must be provided for transition",
      };
    }

    return { valid: true };
  }

  /**
   * Executes the transition steps.
   */
  private async executeTransition(transitionId: TransitionId): Promise<void> {
    const transition = this.transitions.get(transitionId)!;

    try {
      // Step 1: Validate
      this.updateTransitionStatus(transitionId, "validating");
      await this.validateSourceState(transition);

      // Step 2: Save state
      this.updateTransitionStatus(transitionId, "saving_state");
      await this.savePlayerState(transition);

      // Step 3: Transfer
      this.updateTransitionStatus(transitionId, "transferring");
      await this.transferPlayerToDestination(transition);

      // Step 4: Complete
      this.updateTransitionStatus(transitionId, "completing");
      await this.completeTransition(transition);

      // Mark as completed
      const now = Date.now();
      this.transitions.set(transitionId, {
        ...transition,
        status: "completed",
        completedAt: now,
      });
      this.activePlayerTransitions.delete(transition.playerId);

      console.log(
        `[TransitionManager] Completed transition ${transitionId} for player ${transition.playerId}`
      );
    } catch (error) {
      // Rollback on failure
      await this.rollbackTransition(transitionId, error instanceof Error ? error.message : "Unknown error");
      throw error;
    }
  }

  /**
   * Validates the source state before transfer.
   */
  private async validateSourceState(transition: RegionTransition): Promise<void> {
    // In production, this would verify the player state is consistent
    // and that no conflicting operations are in progress
    console.log(`[TransitionManager] Validating source state for transition ${transition.transitionId}`);
    
    // Simulate validation delay
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /**
   * Saves the player state durably before transfer.
   */
  private async savePlayerState(transition: RegionTransition): Promise<void> {
    // In production, this would write the player state to a durable store
    // with transaction guarantees
    console.log(`[TransitionManager] Saving player state for transition ${transition.transitionId}`);
    
    // Simulate save delay
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /**
   * Transfers the player to the destination region.
   */
  private async transferPlayerToDestination(transition: RegionTransition): Promise<void> {
    // Mark source session as transferred
    sessionRegistry.transferSession(
      transition.sourceSessionId,
      transition.destinationServerInstanceId,
      transition.destinationRegionId
    );

    console.log(`[TransitionManager] Transferred player to destination for transition ${transition.transitionId}`);
    
    // Simulate transfer delay
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /**
   * Completes the transition by creating a new session on the destination.
   */
  private async completeTransition(transition: RegionTransition): Promise<void> {
    // Create new session on destination server
    const sessionResult = sessionRegistry.createSession({
      playerId: transition.playerId,
      serverInstanceId: transition.destinationServerInstanceId,
      regionId: transition.destinationRegionId,
      connectionId: `connection-${randomUUID().substring(0, 8)}`,
      sessionDurationMs: 60 * 60 * 1000, // 1 hour
      metadata: {
        transitionId: transition.transitionId,
        previousSessionId: transition.sourceSessionId,
      },
    });

    if (!sessionResult.success) {
      throw new Error(`Failed to create session on destination: ${sessionResult.reason}`);
    }

    // Store the new session ID in the transition metadata
    const updatedTransition = {
      ...transition,
      metadata: {
        ...transition.metadata,
        newSessionId: sessionResult.session!.sessionId,
      },
    };

    this.transitions.set(transition.transitionId, updatedTransition);

    console.log(`[TransitionManager] Created new session ${sessionResult.session!.sessionId} on destination`);
    
    // Simulate completion delay
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /**
   * Rolls back a failed transition.
   */
  private async rollbackTransition(transitionId: TransitionId, reason: string): Promise<void> {
    const transition = this.transitions.get(transitionId)!;
    const now = Date.now();

    this.transitions.set(transitionId, {
      ...transition,
      status: "rolled_back",
      failedAt: now,
      failureReason: reason,
    });

    this.activePlayerTransitions.delete(transition.playerId);

    console.error(
      `[TransitionManager] Rolled back transition ${transitionId} for player ${transition.playerId}: ${reason}`
    );
  }

  /**
   * Updates the status of a transition.
   */
  private updateTransitionStatus(transitionId: TransitionId, status: TransitionStatus): void {
    const transition = this.transitions.get(transitionId)!;
    this.transitions.set(transitionId, { ...transition, status });
    console.log(`[TransitionManager] Transition ${transitionId} status: ${status}`);
  }

  /**
   * Gets the new session ID from a completed transition.
   */
  private getNewSessionId(transitionId: TransitionId): SessionId | undefined {
    const transition = this.transitions.get(transitionId);
    return transition?.metadata?.newSessionId as SessionId | undefined;
  }

  /**
   * Gets the status of a transition.
   */
  getTransitionStatus(transitionId: TransitionId): RegionTransition | undefined {
    return this.transitions.get(transitionId);
  }

  /**
   * Gets the active transition for a player.
   */
  getPlayerTransition(playerId: PlayerId): RegionTransition | undefined {
    const transitionId = this.activePlayerTransitions.get(playerId);
    if (!transitionId) {
      return undefined;
    }
    return this.transitions.get(transitionId);
  }

  /**
   * Cleans up old completed/failed transitions.
   */
  cleanupOldTransitions(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [transitionId, transition] of this.transitions.entries()) {
      const age = now - transition.initiatedAt;
      if (age > maxAgeMs && 
          (transition.status === "completed" || transition.status === "rolled_back")) {
        this.transitions.delete(transitionId);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// Singleton instance
export const transitionManager = new TransitionManager();

/**
 * Default timeout for a transition (30 seconds).
 */
export const TRANSITION_TIMEOUT_MS = 30_000;
