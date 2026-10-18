/**
 * One-World Scaling Infrastructure
 * 
 * This module provides the foundation for scaling Naija: One World
 * from a single-server prototype to a distributed, multi-server architecture
 * while maintaining the principle of one authoritative Nigerian world.
 * 
 * Key components:
 * - World Identity: Ensures exactly one authoritative Nigeria world
 * - Region Ownership: Manages which server owns which geographic regions
 * - Session Management: Handles player sessions, reconnection, and transfers
 * - Region Transitions: Manages cross-region player movement
 * - Data Classification: Categorizes data by consistency requirements
 * - Idempotent Operations: Prevents duplicate financial transactions
 */

export * from "./world-identity.js";
export * from "./region-ownership.js";
export * from "./session-manager.js";
export * from "./region-transition.js";
export * from "./data-classification.js";
export * from "./idempotent-operations.js";
