/**
 * Stage 31 — Organisation hierarchy and office placement.
 *
 * Federal, state, and local governments have separate authority scopes. An office definition names one scope (its
 * kind of organisation), and it may sit only in an organisation of that kind. Nothing here grants authority by itself:
 * the resolver in authority.ts still requires an effective appointment. This module answers only "is this office in a
 * compatible organisation?", from trusted records and the catalogue.
 *
 * Scopes that have no organisation in the model (federal_agency, state_ministry, state_department) match no
 * organisation, so an office of those scopes is never placed and never confers authority. That is the fail-closed
 * default. Adding such an organisation is a data and rules decision, not a code default.
 */
import type { PersistentWorldState } from "../multiplayer/types.js";
import type {
  GovernmentCatalog,
  GovernmentLevel,
  GovernmentOfficeRecord,
  GovernmentOrganisationRecord,
  Institution,
  OfficeScope,
  TreasuryPermission,
} from "./types.js";

export const FEDERAL_ORGANISATION_ID = "gov:federal";

export const OFFICE_SCOPES: readonly OfficeScope[] = [
  "federal_government",
  "federal_ministry",
  "federal_agency",
  "electoral_commission",
  "state_government",
  "state_ministry",
  "state_department",
  "local_government",
];

export const SCOPE_LEVEL: Readonly<Record<OfficeScope, GovernmentLevel>> = {
  federal_government: "federal",
  federal_ministry: "federal",
  federal_agency: "federal",
  electoral_commission: "federal",
  state_government: "state",
  state_ministry: "state",
  state_department: "state",
  local_government: "local",
};

export const INSTITUTIONS: readonly Institution[] = ["executive", "electoral"];

export const TREASURY_PERMISSIONS: readonly TreasuryPermission[] = ["budget_approve", "budget_allocate", "budget_spend"];

export type PlacementCode =
  | "office_definition_missing"
  | "organisation_missing"
  | "office_level_mismatch"
  | "office_institution_incompatible"
  | "organisation_kind_unrecognised"
  | "office_scope_incompatible";

export type PlacementDecision =
  | { readonly ok: true; readonly scope: OfficeScope }
  | { readonly ok: false; readonly code: PlacementCode };

/** Absent institution means executive (records written before Stage 31 have no field). */
export function institutionOf(organisation: Pick<GovernmentOrganisationRecord, "institution">): Institution {
  return organisation.institution ?? "executive";
}

const STATE_JURISDICTION = /^ng:state:[a-z0-9-]+$/;
const LGA_JURISDICTION = /^ng:lga:([a-z0-9-]+):[a-z0-9-]+$/;

/**
 * The kind of an organisation, derived from its own record and its parent chain. Returns null when the record does
 * not fit any kind, for example a state government with no federal parent, or an LGA whose state does not match.
 */
export function organisationKind(
  state: PersistentWorldState,
  organisation: GovernmentOrganisationRecord,
  catalog: GovernmentCatalog,
): OfficeScope | null {
  if (institutionOf(organisation) === "electoral") {
    const independent = catalog.independent_institutions.find((i) => i.organisation_id === organisation.organisation_id);
    const isIndependent = independent !== undefined && independent.scope === "electoral_commission" &&
      independent.institution === "electoral";
    const standalone = organisation.level === "federal" && organisation.parent_organisation_id === null &&
      organisation.ministry_id === null && organisation.jurisdiction_id === null;
    return isIndependent && standalone ? "electoral_commission" : null;
  }

  if (organisation.level === "federal") {
    if (organisation.jurisdiction_id !== null) return null;
    if (organisation.ministry_id === null) {
      return organisation.parent_organisation_id === null ? "federal_government" : null;
    }
    const ministry = catalog.federal_ministries.find((m) => m.id === organisation.ministry_id);
    const fitsMinistry = ministry !== undefined && organisation.organisation_id === `gov:${ministry.id}` &&
      organisation.parent_organisation_id === FEDERAL_ORGANISATION_ID;
    return fitsMinistry ? "federal_ministry" : null;
  }

  if (organisation.level === "state") {
    if (organisation.ministry_id !== null || organisation.parent_organisation_id !== FEDERAL_ORGANISATION_ID) return null;
    return organisation.jurisdiction_id !== null && STATE_JURISDICTION.test(organisation.jurisdiction_id)
      ? "state_government"
      : null;
  }

  // Local: an LGA government sits under a state government, and its LGA must belong to that same state.
  if (organisation.ministry_id !== null || organisation.jurisdiction_id === null) return null;
  const lga = LGA_JURISDICTION.exec(organisation.jurisdiction_id);
  if (!lga || organisation.parent_organisation_id === null) return null;
  const parent = state.governmentOrganisations[organisation.parent_organisation_id];
  if (!parent || parent.level !== "state" || organisationKind(state, parent, catalog) !== "state_government") return null;
  return parent.jurisdiction_id === `ng:state:${lga[1]}` ? "local_government" : null;
}

/**
 * Whether an office may sit in its organisation. Checks run in a fixed order, so the first failing check is reported:
 * definition, organisation, level (kept as the earlier code for compatibility), institution, kind, then scope.
 */
export function officePlacement(
  state: PersistentWorldState,
  office: Pick<GovernmentOfficeRecord, "definition_id" | "organisation_id">,
  catalog: GovernmentCatalog,
): PlacementDecision {
  const definition = catalog.seed_offices.find((d) => d.id === office.definition_id);
  if (!definition) return { ok: false, code: "office_definition_missing" };
  const organisation = state.governmentOrganisations[office.organisation_id];
  if (!organisation) return { ok: false, code: "organisation_missing" };
  if (definition.level !== organisation.level) return { ok: false, code: "office_level_mismatch" };
  if (definition.institution !== institutionOf(organisation)) return { ok: false, code: "office_institution_incompatible" };
  const kind = organisationKind(state, organisation, catalog);
  if (kind === null) return { ok: false, code: "organisation_kind_unrecognised" };
  if (definition.scope !== kind) return { ok: false, code: "office_scope_incompatible" };
  return { ok: true, scope: kind };
}

export interface GovernmentStructureAudit {
  /** Offices whose placement is compatible. They may grant authority, subject to appointment and status checks. */
  readonly placed: readonly string[];
  /** Offices that are not placed, with the exact reason. They grant nothing until corrected. */
  readonly unresolved: readonly { readonly office_id: string; readonly definition_id: string;
    readonly organisation_id: string; readonly code: PlacementCode }[];
}

/** Audits every office record against the hierarchy. Read-only. Used by tests and by the stage documentation. */
export function auditGovernmentStructure(state: PersistentWorldState, catalog: GovernmentCatalog): GovernmentStructureAudit {
  const placed: string[] = [];
  const unresolved: { office_id: string; definition_id: string; organisation_id: string; code: PlacementCode }[] = [];
  for (const office of Object.values(state.governmentOffices)) {
    const decision = officePlacement(state, office, catalog);
    if (decision.ok) placed.push(office.office_id);
    else unresolved.push({ office_id: office.office_id, definition_id: office.definition_id,
      organisation_id: office.organisation_id, code: decision.code });
  }
  placed.sort();
  unresolved.sort((a, b) => a.office_id.localeCompare(b.office_id));
  return { placed, unresolved };
}
