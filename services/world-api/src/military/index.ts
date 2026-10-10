/**
 * Stage 14 — Military System
 * Public API for the military module.
 */

export { MilitaryService, emptyMilitaryMaps, initializeMilitaryWorldState, seedMilitaryWorld, militaryErrorMessage } from "./service.js";
export { MilitaryCatalogService, loadMilitaryCatalog } from "./catalog.js";
export type {
  PersistentMilitaryMaps,
  MilitaryOrganizationRecord,
  MilitaryBaseRecord,
  MilitaryUnitRecord,
  MilitaryRecruitmentRecord,
  MilitaryServiceRecord,
  MilitaryTrainingRecord,
  MilitaryRankHistoryRecord,
  MilitaryCommandAppointmentRecord,
  MilitaryAssignmentRecord,
  MilitaryLeaveRecord,
  MilitaryAssetRecord,
  NationalSecurityEventRecord,
  MilitaryDisciplinaryRecord,
  MilitaryAuditRecord,
  MilitaryCatalog,
  MilitaryRules,
  ServiceBranchId,
  RankCategoryId,
  BaseCategoryId,
  UnitCategoryId,
  AssignmentTypeId,
  EquipmentCategoryId,
  NationalSecurityEventCategoryId,
  DisciplinaryOutcomeId,
  ServiceMemberStatusId,
  ApplicationStatusId,
  TrainingStatusId,
  AssignmentStatusId,
  AssetStatusId,
  DisciplinaryCaseStatusId,
  NationalSecurityEventStatusId,
  LeaveStatusId,
  MilitaryBaseSnapshot,
  MilitaryUnitSnapshot,
  MilitaryServiceSnapshot,
  MilitaryProfileSnapshot,
} from "./types.js";
