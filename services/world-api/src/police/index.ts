/**
 * Stage 13 — Police and Security System
 *
 * Public API for the police module.
 */

export { PoliceService, emptyPoliceMaps, initializePoliceWorldState, seedPoliceWorld, policeErrorMessage } from "./service.js";
export { PoliceCatalogService, loadPoliceCatalog } from "./catalog.js";
export type {
  PersistentPoliceMaps,
  PoliceUnitRecord,
  PoliceOfficerRecord,
  RecruitmentRecord,
  IncidentRecord,
  DispatchRecord,
  InvestigationRecord,
  PoliceEvidenceRecord,
  WantedRecord,
  ArrestRecord,
  MisconductComplaintRecord,
  PoliceAuditRecord,
  PoliceCatalog,
  PoliceRules,
  RankId,
  IncidentCategoryId,
  DispatchPriorityId,
  MisconductCategoryId,
  ComplaintOutcomeId,
  IncidentStatusId,
  DispatchStatusId,
  InvestigationStatusId,
  WantedStatusId,
  ArrestStatusId,
  ComplaintStatusId,
  OfficerStatusId,
  PoliceLevelId,
  PoliceStationSnapshot,
  OfficerSnapshot,
  IncidentSnapshot,
  InvestigationSnapshot,
  PoliceProfileSnapshot,
} from "./types.js";
