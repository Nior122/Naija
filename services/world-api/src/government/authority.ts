/**
 * Stage 30 — Office authority resolution (Stage 28 authority model, rules G-2, G-3, G-8 and principles 1 to 3).
 *
 * This module answers one question from authoritative server state: does this character hold an effective office
 * authority over this organisation on this world date? It reads only persisted records (appointments, offices,
 * organisations, and players). Nothing a client sends is read here.
 *
 * An appointment is effective only when all of these hold:
 *   - its status is "active" (ended and removed appointments never confer authority);
 *   - its start is not in the future, and its term has not ended (end_world_date absent or after the date);
 *   - its office exists, is not suspended, and is not contested (a unique office with two live appointments is
 *     contested, and neither holder is effective);
 *   - its organisation exists and is active;
 *   - its holder exists and is not deceased.
 *
 * Scope is exact: an office authorises only its own organisation. No hierarchy is assumed. A federal office does not
 * authorise a ministry, and a state or local office does not authorise any other organisation (rule R-c is undecided;
 * exact scope is the conservative default, not a policy decision).
 *
 * This module grants no permission by itself. Which offices may take which government action is an owner decision
 * (R-a and R-b in docs/STAGE_28_GOVERNMENT_AUTHORIZATION.md). Government mutations stay suspended at the engine until
 * those rules exist.
 */
import { compareDates } from "../life/calendar.js";
import type { CalendarDate } from "../life/types.js";
import type { PersistentWorldState } from "../multiplayer/types.js";
import { loadGovernmentCatalog } from "./catalog.js";
import type { AppointmentRecord, GovernmentCatalog, GovernmentLevel, GovernmentOfficeRecord, OfficeStatus } from "./types.js";

/** Why one appointment does or does not confer authority on a given date. */
export type AppointmentAuthorityState =
  | "effective"
  | "appointment_not_active"
  | "not_yet_started"
  | "term_ended"
  | "office_missing"
  | "office_suspended"
  | "office_contested"
  | "organisation_inactive"
  | "office_definition_missing"
  | "office_level_mismatch"
  | "holder_missing"
  | "holder_deceased";

/** The occupancy state of an office on a given date. */
export type OfficeOccupancy = "missing" | "suspended" | "contested" | "occupied" | "vacant";

export interface OfficeAuthorityGrant {
  readonly appointment_id: string;
  readonly office_id: string;
  readonly definition_id: string;
  readonly organisation_id: string;
  readonly level: GovernmentLevel;
  readonly jurisdiction_id: string | null;
  readonly character_id: string;
}

export type OfficeAuthorityDecision =
  | { readonly ok: true; readonly grant: OfficeAuthorityGrant }
  | { readonly ok: false; readonly code: "government_authority_none" | "government_authority_scope" };

function characterExists(state: PersistentWorldState, characterId: string): { exists: boolean; deceased: boolean } {
  for (const player of Object.values(state.players)) {
    if (player.character.character_id === characterId) {
      return { exists: true, deceased: player.character.life_status === "deceased" };
    }
  }
  return { exists: false, deceased: false };
}

/** Live means: active, started on or before the date, and its term not yet ended on the date. */
export function isLiveAppointment(appointment: AppointmentRecord, date: CalendarDate): boolean {
  if (appointment.status !== "active") return false;
  if (compareDates(appointment.start_world_date, date) > 0) return false;
  if (appointment.end_world_date && compareDates(appointment.end_world_date, date) <= 0) return false;
  return true;
}

/** The occupancy of an office on the date. A missing office is reported as "missing", never as vacant. */
export function officeOccupancy(state: PersistentWorldState, officeId: string, date: CalendarDate): OfficeOccupancy {
  const office = state.governmentOffices[officeId];
  if (!office) return "missing";
  if (office.status === "suspended") return "suspended";
  const live = Object.values(state.governmentAppointments).filter(
    (a) => a.office_id === officeId && isLiveAppointment(a, date),
  );
  if (live.length === 0) return "vacant";
  if (office.unique && live.length > 1) return "contested";
  return "occupied";
}

/** Why one appointment does or does not confer authority on the date. Checks run from the appointment outward. */
export function appointmentAuthorityState(
  state: PersistentWorldState,
  appointment: AppointmentRecord,
  date: CalendarDate,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): AppointmentAuthorityState {
  if (appointment.status !== "active") return "appointment_not_active";
  if (compareDates(appointment.start_world_date, date) > 0) return "not_yet_started";
  if (appointment.end_world_date && compareDates(appointment.end_world_date, date) <= 0) return "term_ended";

  const office: GovernmentOfficeRecord | undefined = state.governmentOffices[appointment.office_id];
  if (!office) return "office_missing";
  if (office.status === "suspended") return "office_suspended";

  const organisation = state.governmentOrganisations[office.organisation_id];
  if (!organisation || organisation.status !== "active") return "organisation_inactive";

  // The office's level in the catalogue must match the level of the organisation it sits in. The seeded world places
  // every office in the federal organisation, including state and local ones, so those appointments confer nothing
  // until the placement is corrected (rule R-c). Failing closed here is deliberate.
  const definition = catalog.seed_offices.find((d) => d.id === office.definition_id);
  if (!definition) return "office_definition_missing";
  if (definition.level !== organisation.level) return "office_level_mismatch";

  const occupancy = officeOccupancy(state, office.office_id, date);
  if (occupancy === "contested") return "office_contested";

  const holder = characterExists(state, appointment.character_id);
  if (!holder.exists) return "holder_missing";
  if (holder.deceased) return "holder_deceased";

  return "effective";
}

/** Every effective office grant the character holds on the date, from trusted records only. */
export function effectiveOfficeGrants(
  state: PersistentWorldState,
  characterId: string,
  date: CalendarDate,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): OfficeAuthorityGrant[] {
  const grants: OfficeAuthorityGrant[] = [];
  for (const appointment of Object.values(state.governmentAppointments)) {
    if (appointment.character_id !== characterId) continue;
    if (appointmentAuthorityState(state, appointment, date, catalog) !== "effective") continue;
    const office = state.governmentOffices[appointment.office_id];
    const organisation = office ? state.governmentOrganisations[office.organisation_id] : undefined;
    if (!office || !organisation) continue;
    grants.push({
      appointment_id: appointment.appointment_id,
      office_id: office.office_id,
      definition_id: office.definition_id,
      organisation_id: organisation.organisation_id,
      level: organisation.level,
      jurisdiction_id: organisation.jurisdiction_id,
      character_id: characterId,
    });
  }
  return grants;
}

/**
 * Decides whether the character may act with office authority over the organisation on the date.
 *   - `government_authority_none`: the character holds no effective office at all (ordinary citizen, expired, ended,
 *     revoked, suspended, contested, or deceased holder).
 *   - `government_authority_scope`: the character holds an effective office, but not one over this organisation.
 * A decision of `ok: true` is necessary but not sufficient for a mutation: the permission for the specific action is
 * a separate rule that has not been decided (R-b).
 */
export function authorizeGovernmentActor(
  state: PersistentWorldState,
  characterId: string,
  organisationId: string,
  date: CalendarDate,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): OfficeAuthorityDecision {
  const grants = effectiveOfficeGrants(state, characterId, date, catalog);
  if (grants.length === 0) return { ok: false, code: "government_authority_none" };
  const inScope = grants.find((grant) => grant.organisation_id === organisationId);
  if (!inScope) return { ok: false, code: "government_authority_scope" };
  return { ok: true, grant: inScope };
}

/** Type guard for the optional office status field. Absent or null means active (the seeded state has no field). */
export function isOfficeSuspended(office: { readonly status?: OfficeStatus | null }): boolean {
  return office.status === "suspended";
}
