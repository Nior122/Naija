/**
 * Stage 38 — crime target validation.
 *
 * `commit_crime` names its victims in the request. Before this stage the engine stored those identifiers as given: a
 * victim could be any string, a victim could be the perpetrator, and a property or business could be named without
 * anyone checking that it existed or who owned it. This module checks each supplied target against the authoritative
 * world state, and returns only the identifiers it has checked. The engine passes those identifiers on, and never the
 * raw request values.
 *
 * The rules follow the catalogue. A definition that requires a target type (requires_target_character,
 * requires_target_property, requires_target_business) must name one, and it must be valid. A target type the definition
 * does not require is refused when supplied, so that a request cannot attach a victim the crime does not have.
 *
 * Owner identity comes from the server: for a property, the active ownership record; for a business, its owner
 * character. The perpetrator may not be the victim, or the owner of the property or business.
 *
 * What this does not do: it does not add any criminal capability, and it does not change how crimes are detected or
 * resolved. NPC victims are not supported by this route, so a victim must be a character in state.players.
 */

import type { PersistentWorldState } from "../multiplayer/types.js";
import type { CrimeDefinition } from "./types.js";

export interface CrimeTargetRequest {
  victim_character_id: string | null;
  victim_property_id: string | null;
  victim_business_id: string | null;
}

export type ValidatedCrimeTargets = CrimeTargetRequest;

/**
 * Reads one target identifier from a request. Absent or null means no target. A value that is not a non-empty string of
 * at most 96 characters is refused as crime_target_invalid, so that a malformed target is never silently dropped.
 */
export function parseTargetId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 96) throw new Error("crime_target_invalid");
  return value;
}

/** A stable error code for a refused target. Each code is a plain lowercase identifier, so the engine reports it as is. */
export type CrimeTargetError =
  | "crime_victim_required"
  | "crime_victim_not_found"
  | "crime_victim_is_perpetrator"
  | "crime_victim_unavailable"
  | "crime_property_required"
  | "crime_property_not_found"
  | "crime_property_not_owned"
  | "crime_business_required"
  | "crime_business_not_found"
  | "crime_target_not_applicable"
  | "crime_target_invalid";

function characterExists(state: PersistentWorldState, characterId: string): { exists: boolean; deceased: boolean } {
  for (const entry of Object.values(state.players)) {
    if (entry.character.character_id === characterId) {
      return { exists: true, deceased: entry.character.life_status === "deceased" };
    }
  }
  return { exists: false, deceased: false };
}

/**
 * Validates the targets of one crime. Throws an Error whose message is a CrimeTargetError code. Throws before the
 * caller changes anything.
 */
export function validateCrimeTargets(
  state: PersistentWorldState,
  definition: CrimeDefinition,
  perpetratorId: string,
  requested: CrimeTargetRequest,
): ValidatedCrimeTargets {
  // Character target.
  if (definition.requires_target_character) {
    if (!requested.victim_character_id) throw new Error("crime_victim_required");
    if (requested.victim_character_id === perpetratorId) throw new Error("crime_victim_is_perpetrator");
    const victim = characterExists(state, requested.victim_character_id);
    if (!victim.exists) throw new Error("crime_victim_not_found");
    if (victim.deceased) throw new Error("crime_victim_unavailable");
  } else if (requested.victim_character_id) {
    throw new Error("crime_target_not_applicable");
  }

  // Property target.
  let propertyId: string | null = null;
  if (definition.requires_target_property) {
    if (!requested.victim_property_id) throw new Error("crime_property_required");
    if (!state.properties[requested.victim_property_id]) throw new Error("crime_property_not_found");
    const owners = Object.values(state.propertyOwnership).filter(
      (o) => o.property_id === requested.victim_property_id && o.active,
    );
    if (owners.length === 0) throw new Error("crime_property_not_owned");
    // A player-owned record names a character as its owner. Owner IDs are compared directly.
    if (owners.some((o) => o.owner_id === perpetratorId)) {
      throw new Error("crime_victim_is_perpetrator");
    }
    propertyId = requested.victim_property_id;
  } else if (requested.victim_property_id) {
    throw new Error("crime_target_not_applicable");
  }

  // Business target.
  let businessId: string | null = null;
  if (definition.requires_target_business) {
    if (!requested.victim_business_id) throw new Error("crime_business_required");
    const business = state.businesses[requested.victim_business_id];
    if (!business) throw new Error("crime_business_not_found");
    if (business.owner_character_id === perpetratorId) throw new Error("crime_victim_is_perpetrator");
    businessId = requested.victim_business_id;
  } else if (requested.victim_business_id) {
    throw new Error("crime_target_not_applicable");
  }

  return {
    victim_character_id: definition.requires_target_character ? requested.victim_character_id : null,
    victim_property_id: propertyId,
    victim_business_id: businessId,
  };
}
