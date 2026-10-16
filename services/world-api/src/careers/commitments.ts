import type { PersistentWorldState } from "../multiplayer/types.js";

/**
 * Stage 43: one full work commitment at a time. A character who holds an active career employment cannot be hired by a
 * business, and a character who holds an active business employment is refused a career job. The two records stay in
 * their own maps (`employments` and `businessOwnership`), and this module is the only place that reads both to decide
 * whether a commitment already exists. Owning a business is not employment, and is not checked here.
 */
export const ACTIVE_CAREER_EMPLOYMENT_STATUSES: ReadonlySet<string> = new Set(["active", "on_leave", "suspended"]);

/** True when the character holds an active career employment. */
export function hasActiveCareerEmployment(state: PersistentWorldState, characterId: string): boolean {
  return Object.values(state.employments).some((employment) =>
    employment.character_id === characterId && ACTIVE_CAREER_EMPLOYMENT_STATUSES.has(employment.status));
}

/** True when the character is an active employee of any business. */
export function hasActiveBusinessEmployment(state: PersistentWorldState, characterId: string): boolean {
  return Object.values(state.businessOwnership ?? {}).some((record) =>
    record.character_id === characterId && record.role === "employee" && record.active);
}
