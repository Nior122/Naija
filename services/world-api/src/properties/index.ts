/**
 * Stage 9 — Housing and Property System
 *
 * Provides configurable property types, locations, ownership,
 * listings, rental agreements, sales, maintenance, and furnishing
 * for the Nigeria world.
 */

export { loadPropertyCatalog, validatePropertyCatalogForTest } from "./catalog.js";
export {
  initializePropertyWorldState,
  seedProperties,
  searchPropertyMarket,
  purchaseProperty,
  listPropertyForSale,
  listPropertyForRent,
  createRentalAgreement,
  payRent,
  terminateRentalAgreement,
  recordMaintenance,
  purchaseFurniture,
  removeFurnishing,
  transferProperty,
  buildPropertyProfile,
  getCharacterProperties,
  getCharacterRentals,
  processPropertyWorldDate,
  propertyErrorMessage,
} from "./service.js";
export type {
  PropertyCategoryCode,
  PropertyCondition,
  PropertyDevelopmentStatus,
  PropertyOwnershipKind,
  PropertyListingType,
  PropertyRentPeriod,
  RentalAgreementStatus,
  PropertyTransactionKind,
  PropertyCategoryDefinition,
  PropertyTypeDefinition,
  PropertyLocationDefinition,
  SeedPropertyDefinition,
  FurnitureDefinition,
  PropertyRules,
  PropertyCatalog,
  PropertyRecord,
  PropertyOwnershipRecord,
  PropertyListingRecord,
  RentalAgreementRecord,
  RentalPaymentRecord,
  PropertySaleRecord,
  PropertyMaintenanceRecord,
  PropertyFurnishingRecord,
  PropertyEventRecord,
  PersistentPropertyMaps,
  PropertyProfileSnapshot,
  PropertyListingSnapshot,
  RentalAgreementSnapshot,
  PropertyMarketSnapshot,
} from "./types.js";
