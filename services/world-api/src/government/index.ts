/**
 * Stage 10 — Government System
 *
 * Provides government organisation, office, appointment, budget,
 * revenue, expenditure, project, and announcement management for
 * the Nigeria world.
 */

export { loadGovernmentCatalog, validateGovernmentCatalogForTest } from "./catalog.js";
export {
  initializeGovernmentWorldState,
  seedGovernmentWorld,
  appointOfficial,
  removeOfficial,
  createBudget,
  getBudgetAvailable,
  recordGovernmentRevenue,
  recordGovernmentExpenditure,
  createProject,
  updateProjectStatus,
  fundProject,
  publishAnnouncement,
  getFederalGovernment,
  getStateGovernment,
  getLocalGovernment,
  searchProjects,
  getPublishedAnnouncements,
  getCharacterAppointments,
  processGovernmentWorldDate,
  governmentErrorMessage,
} from "./service.js";
export type {
  GovernmentLevel,
  ProjectStatus,
  AnnouncementStatus,
  AppointmentStatus,
  BudgetStatus,
  GovernmentLevelDefinition,
  MinistryDefinition,
  ProjectCategoryDefinition,
  BudgetCategoryDefinition,
  RevenueCategoryDefinition,
  ExpenditureCategoryDefinition,
  OfficeDefinition,
  GovernmentRules,
  GovernmentCatalog,
  GovernmentOrganisationRecord,
  GovernmentOfficeRecord,
  AppointmentRecord,
  BudgetRecord,
  GovernmentRevenueRecord,
  GovernmentExpenditureRecord,
  GovernmentProjectRecord,
  GovernmentAnnouncementRecord,
  GovernmentEventRecord,
  PersistentGovernmentMaps,
  GovernmentOrganisationSnapshot,
  AppointmentSnapshot,
  GovernmentProjectSnapshot,
  GovernmentAnnouncementSnapshot,
  FederalGovernmentSnapshot,
  StateGovernmentSnapshot,
  LocalGovernmentSnapshot,
} from "./types.js";
