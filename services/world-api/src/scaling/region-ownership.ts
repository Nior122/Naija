/**
 * Region Ownership and Partitioning
 * 
 * Manages which server/worker is responsible for which geographic regions.
 * Uses fencing tokens and leases to prevent stale owners from writing.
 * Supports multiple partitions within busy cities.
 */

import { randomUUID } from "node:crypto";

export type RegionId = string;
export type ServerInstanceId = string;

export interface RegionPartition {
  readonly regionId: RegionId;
  readonly partitionIndex: number;
  readonly totalPartitions: number;
}

export interface RegionOwnership {
  readonly regionId: RegionId;
  readonly ownerInstanceId: ServerInstanceId;
  readonly fencingToken: number;
  readonly leasedUntil: number; // Unix timestamp in milliseconds
  readonly lastHeartbeat: number;
  readonly status: "active" | "expired" | "contested" | "released";
  readonly acquiredAt: number;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface RegionOwnershipRequest {
  readonly regionId: RegionId;
  readonly requesterInstanceId: ServerInstanceId;
  readonly leaseDurationMs: number;
  readonly metadata?: Record<string, unknown>;
}

export interface RegionOwnershipResult {
  readonly success: boolean;
  readonly ownership?: RegionOwnership;
  readonly reason?: string;
  readonly conflict?: {
    currentOwner: ServerInstanceId;
    leasedUntil: number;
  };
}

/**
 * In-memory region ownership registry.
 * In production, this would be backed by a distributed database with transactions.
 */
class RegionOwnershipRegistry {
  private ownerships = new Map<RegionId, RegionOwnership>();
  private fencingCounters = new Map<RegionId, number>();

  /**
   * Attempts to acquire ownership of a region.
   * Uses fencing tokens to prevent stale writes.
   */
  acquireOwnership(request: RegionOwnershipRequest): RegionOwnershipResult {
    const now = Date.now();
    const existing = this.ownerships.get(request.regionId);

    // Check if region is already owned and lease is still valid
    if (existing && existing.leasedUntil > now && existing.status === "active") {
      // Cannot acquire - already owned by another active server
      if (existing.ownerInstanceId !== request.requesterInstanceId) {
        return {
          success: false,
          reason: "Region is already owned by another server with an active lease",
          conflict: {
            currentOwner: existing.ownerInstanceId,
            leasedUntil: existing.leasedUntil,
          },
        };
      }
      // Same server requesting - extend the lease
      return this.extendLease(request, existing);
    }

    // Region is available (no owner, expired lease, or released)
    const fencingToken = this.getNextFencingToken(request.regionId);
    const ownership: RegionOwnership = {
      regionId: request.regionId,
      ownerInstanceId: request.requesterInstanceId,
      fencingToken,
      leasedUntil: now + request.leaseDurationMs,
      lastHeartbeat: now,
      status: "active",
      acquiredAt: now,
      metadata: request.metadata,
    };

    this.ownerships.set(request.regionId, ownership);

    console.log(
      `[RegionOwnership] Server ${request.requesterInstanceId} acquired region ${request.regionId} ` +
      `with fencing token ${fencingToken}, lease until ${new Date(ownership.leasedUntil).toISOString()}`
    );

    return { success: true, ownership };
  }

  /**
   * Extends the lease for an already-owned region.
   */
  private extendLease(
    request: RegionOwnershipRequest,
    existing: RegionOwnership
  ): RegionOwnershipResult {
    const now = Date.now();
    const extendedOwnership: RegionOwnership = {
      ...existing,
      leasedUntil: now + request.leaseDurationMs,
      lastHeartbeat: now,
      metadata: request.metadata ?? existing.metadata,
    };

    this.ownerships.set(request.regionId, extendedOwnership);

    return { success: true, ownership: extendedOwnership };
  }

  /**
   * Releases ownership of a region.
   * Only the current owner can release.
   */
  releaseOwnership(regionId: RegionId, ownerInstanceId: ServerInstanceId): boolean {
    const existing = this.ownerships.get(regionId);
    if (!existing) {
      return false;
    }

    if (existing.ownerInstanceId !== ownerInstanceId) {
      console.warn(
        `[RegionOwnership] Server ${ownerInstanceId} attempted to release region ${regionId} ` +
        `owned by ${existing.ownerInstanceId}`
      );
      return false;
    }

    const releasedOwnership: RegionOwnership = {
      ...existing,
      status: "released",
      leasedUntil: Date.now(),
    };

    this.ownerships.set(regionId, releasedOwnership);

    console.log(
      `[RegionOwnership] Server ${ownerInstanceId} released region ${regionId}`
    );

    return true;
  }

  /**
   * Validates that a server has active ownership with the correct fencing token.
   * Prevents stale owners from writing after their lease expired.
   */
  validateOwnership(
    regionId: RegionId,
    ownerInstanceId: ServerInstanceId,
    fencingToken: number
  ): { valid: boolean; reason?: string } {
    const existing = this.ownerships.get(regionId);
    const now = Date.now();

    if (!existing) {
      return { valid: false, reason: "Region has no owner" };
    }

    if (existing.status !== "active") {
      return { valid: false, reason: `Region ownership status is ${existing.status}` };
    }

    if (existing.leasedUntil <= now) {
      // Lease expired - mark as expired
      this.ownerships.set(regionId, { ...existing, status: "expired" });
      return { valid: false, reason: "Lease has expired" };
    }

    if (existing.ownerInstanceId !== ownerInstanceId) {
      return {
        valid: false,
        reason: `Region is owned by ${existing.ownerInstanceId}, not ${ownerInstanceId}`,
      };
    }

    if (existing.fencingToken !== fencingToken) {
      return {
        valid: false,
        reason: `Fencing token mismatch: expected ${existing.fencingToken}, got ${fencingToken}. ` +
          `This indicates a stale owner attempting to write.`,
      };
    }

    // Update heartbeat
    this.ownerships.set(regionId, { ...existing, lastHeartbeat: now });

    return { valid: true };
  }

  /**
   * Gets the current ownership information for a region.
   */
  getOwnership(regionId: RegionId): RegionOwnership | undefined {
    return this.ownerships.get(regionId);
  }

  /**
   * Gets all regions owned by a specific server.
   */
  getRegionsOwnedBy(instanceId: ServerInstanceId): RegionOwnership[] {
    const now = Date.now();
    return Array.from(this.ownerships.values()).filter(
      (o) => o.ownerInstanceId === instanceId && o.leasedUntil > now && o.status === "active"
    );
  }

  /**
   * Cleans up expired leases.
   * Should be called periodically.
   */
  cleanupExpiredLeases(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [regionId, ownership] of this.ownerships.entries()) {
      if (ownership.leasedUntil <= now && ownership.status === "active") {
        this.ownerships.set(regionId, { ...ownership, status: "expired" });
        cleaned++;
        console.log(
          `[RegionOwnership] Lease expired for region ${regionId} ` +
          `(owner: ${ownership.ownerInstanceId})`
        );
      }
    }

    return cleaned;
  }

  /**
   * Gets the next fencing token for a region.
   * Fencing tokens are monotonically increasing per region.
   */
  private getNextFencingToken(regionId: RegionId): number {
    const current = this.fencingCounters.get(regionId) ?? 0;
    const next = current + 1;
    this.fencingCounters.set(regionId, next);
    return next;
  }
}

// Singleton instance
export const regionOwnershipRegistry = new RegionOwnershipRegistry();

/**
 * Default lease duration for region ownership (30 seconds).
 */
export const DEFAULT_LEASE_DURATION_MS = 30_000;

/**
 * Recommended heartbeat interval (should be < lease duration / 2).
 */
export const RECOMMENDED_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Geographic region definitions based on Nigerian states.
 * In production, this would be loaded from the geography system.
 */
export const GEOGRAPHIC_REGIONS = {
  // Major cities get multiple partitions for load distribution
  "lagos-mainland": { partitions: 4, priority: "high" },
  "lagos-island": { partitions: 2, priority: "high" },
  "abuja-central": { partitions: 3, priority: "high" },
  "kano-city": { partitions: 2, priority: "medium" },
  "ibadan-city": { partitions: 2, priority: "medium" },
  
  // State-level regions
  "ondo-state": { partitions: 1, priority: "medium" },
  "ogun-state": { partitions: 1, priority: "medium" },
  "oyo-state": { partitions: 1, priority: "medium" },
  "rivers-state": { partitions: 1, priority: "medium" },
  "delta-state": { partitions: 1, priority: "medium" },
  
  // Other states (can be added as needed)
  // ... all 36 states + FCT
} as const;

export type GeographicRegionId = keyof typeof GEOGRAPHIC_REGIONS;

/**
 * Generates a region ID for a specific partition.
 */
export function generateRegionPartitionId(
  regionBase: GeographicRegionId,
  partitionIndex: number
): RegionId {
  const config = GEOGRAPHIC_REGIONS[regionBase];
  if (partitionIndex < 0 || partitionIndex >= config.partitions) {
    throw new Error(
      `Invalid partition index ${partitionIndex} for region ${regionBase} ` +
      `(max: ${config.partitions - 1})`
    );
  }
  return `${regionBase}:partition-${partitionIndex}`;
}
