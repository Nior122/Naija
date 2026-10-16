/**
 * Idempotent Operations
 * 
 * Ensures financial and other high-impact operations are not duplicated.
 * Uses idempotency keys to detect and reject duplicate requests.
 */

import { randomUUID } from "node:crypto";

export type IdempotencyKey = string;

export interface IdempotentOperation {
  readonly idempotencyKey: IdempotencyKey;
  readonly operationType: string;
  readonly playerId: string;
  readonly requestHash: string;
  readonly response?: unknown;
  readonly status: "pending" | "completed" | "failed";
  readonly createdAt: number;
  readonly completedAt?: number;
  readonly expiresAt: number;
}

export interface IdempotentOperationRequest<TRequest, TResponse> {
  readonly idempotencyKey: IdempotencyKey;
  readonly operationType: string;
  readonly playerId: string;
  readonly request: TRequest;
  readonly execute: (request: TRequest) => Promise<TResponse>;
  readonly ttlMs?: number;
}

export interface IdempotentOperationResult<TResponse> {
  readonly success: boolean;
  readonly response?: TResponse;
  readonly duplicate?: boolean;
  readonly originalResponse?: unknown;
  readonly reason?: string;
}

/**
 * In-memory idempotency store.
 * In production, this would be backed by a database with unique constraints.
 */
class IdempotencyStore {
  private operations = new Map<IdempotencyKey, IdempotentOperation>();

  /**
   * Executes an operation with idempotency protection.
   * If the same idempotency key is used again, returns the original response.
   */
  async executeWithIdempotency<TRequest, TResponse>(
    params: IdempotentOperationRequest<TRequest, TResponse>
  ): Promise<IdempotentOperationResult<TResponse>> {
    const { idempotencyKey, operationType, playerId, request, execute, ttlMs } = params;

    // Check if operation already exists
    const existing = this.operations.get(idempotencyKey);
    if (existing) {
      // Check if expired
      if (existing.expiresAt < Date.now()) {
        this.operations.delete(idempotencyKey);
      } else if (existing.status === "completed") {
        // Return the original response
        console.log(
          `[Idempotency] Returning cached response for operation ${idempotencyKey}`
        );
        return {
          success: true,
          duplicate: true,
          originalResponse: existing.response,
          response: existing.response as TResponse,
        };
      } else if (existing.status === "pending") {
        // Operation is still in progress
        return {
          success: false,
          reason: "Operation with this idempotency key is already in progress",
        };
      } else if (existing.status === "failed") {
        // Previous attempt failed, allow retry
        this.operations.delete(idempotencyKey);
      }
    }

    // Create new operation record
    const now = Date.now();
    const operation: IdempotentOperation = {
      idempotencyKey,
      operationType,
      playerId,
      requestHash: this.hashRequest(request),
      status: "pending",
      createdAt: now,
      expiresAt: now + (ttlMs ?? 24 * 60 * 60 * 1000), // Default 24 hours
    };

    this.operations.set(idempotencyKey, operation);

    try {
      // Execute the operation
      const response = await execute(request);

      // Mark as completed
      this.operations.set(idempotencyKey, {
        ...operation,
        status: "completed",
        response,
        completedAt: Date.now(),
      });

      console.log(
        `[Idempotency] Operation ${idempotencyKey} completed successfully`
      );

      return {
        success: true,
        response,
      };
    } catch (error) {
      // Mark as failed
      this.operations.set(idempotencyKey, {
        ...operation,
        status: "failed",
        completedAt: Date.now(),
      });

      console.error(
        `[Idempotency] Operation ${idempotencyKey} failed:`,
        error
      );

      return {
        success: false,
        reason: error instanceof Error ? error.message : "Operation failed",
      };
    }
  }

  /**
   * Gets the status of an idempotent operation.
   */
  getOperationStatus(idempotencyKey: IdempotencyKey): IdempotentOperation | undefined {
    return this.operations.get(idempotencyKey);
  }

  /**
   * Cleans up expired operations.
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, operation] of this.operations.entries()) {
      if (operation.expiresAt < now) {
        this.operations.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Creates a hash of the request for duplicate detection.
   */
  private hashRequest(request: unknown): string {
    // Simple hash for demonstration
    // In production, use a proper cryptographic hash
    const str = JSON.stringify(request);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash &= hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }
}

// Singleton instance
export const idempotencyStore = new IdempotencyStore();

/**
 * Generates a unique idempotency key.
 */
export function generateIdempotencyKey(): IdempotencyKey {
  return `idem-${randomUUID()}`;
}

/**
 * Default TTL for idempotency records (24 hours).
 */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Financial operation types that require idempotency.
 */
export const FINANCIAL_OPERATION_TYPES = [
  "money_transfer",
  "bank_deposit",
  "bank_withdrawal",
  "loan_disbursement",
  "loan_repayment",
  "business_transaction",
  "property_purchase",
  "salary_payment",
] as const;

export type FinancialOperationType = typeof FINANCIAL_OPERATION_TYPES[number];

/**
 * Validates that an operation type requires idempotency.
 */
export function requiresIdempotency(operationType: string): boolean {
  return FINANCIAL_OPERATION_TYPES.includes(operationType as FinancialOperationType);
}
