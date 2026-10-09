/**
 * Stage 8 — Player Businesses and Entrepreneurship
 *
 * Provides configurable business templates, products, services,
 * inventory, sales, production, role-based ownership, and financial
 * ledger for player-owned businesses in the Nigeria world.
 */

export { loadBusinessCatalog, validateBusinessCatalogForTest } from './catalog.js';
export {
  initializeBusinessWorldState,
  createBusiness,
  addBusinessProduct,
  restockInventory,
  sellProduct,
  sellService,
  contributeCapital,
  withdrawFromBusiness,
  recordBusinessExpense,
  runProduction,
  closeBusiness,
  addBranch,
  transferOwnership,
  hireEmployee,
  fireEmployee,
  seedNpcBusinesses,
  processBusinessWorldDate,
  buildBusinessProfile,
  discoverBusinesses,
  businessErrorMessage
} from './service.js';
export type {
  BusinessCategoryCode,
  BusinessModel,
  BusinessStatus,
  BusinessOwnershipRole,
  BusinessPremisesType,
  BusinessTransactionKind,
  BusinessInventoryMovementKind,
  BusinessCategoryDefinition,
  BusinessTemplateDefinition,
  BusinessProductDefinition,
  BusinessProductionRecipeDefinition,
  BusinessRules,
  BusinessCatalog,
  BusinessOwnershipRecord,
  BusinessRecord,
  BusinessBranchRecord,
  BusinessProductRecord,
  BusinessInventoryRecord,
  BusinessInventoryMovementRecord,
  BusinessTransactionRecord,
  BusinessExpenseRecord,
  BusinessSaleRecord,
  BusinessProductionRunRecord,
  BusinessReputationEntry,
  BusinessEventRecord,
  PersistentBusinessMaps,
  BusinessProfileSnapshot,
  BusinessDiscoveryEntry
} from './types.js';
