/**
 * Stage 9 — Housing and Property System
 *
 * Types for properties, ownership, listings, rental agreements,
 * transactions, maintenance, and furnishing.
 */

import type { CalendarDate } from "../life/types.js";

// ─── Catalogue types ──────────────────────────────────────────────

export type PropertyCategoryCode = "cat:residential" | "cat:commercial" | "cat:land" | "cat:public";

export type PropertyCondition = "excellent" | "good" | "fair" | "poor" | "requires_repair";

export type PropertyDevelopmentStatus = "undeveloped" | "reserved" | "under_construction" | "developed";

export type PropertyOwnershipKind = "player" | "npc" | "business" | "government" | "community" | "joint";

export type PropertyListingType = "sale" | "rent" | "none";

export type PropertyRentPeriod = "monthly" | "quarterly" | "half_yearly" | "yearly" | "none";

export type RentalAgreementStatus = "pending" | "active" | "expired" | "terminated" | "cancelled";

export type PropertyTransactionKind = "purchase" | "sale" | "transfer" | "rent_payment" | "deposit" | "maintenance" | "furniture_purchase";

export interface PropertyCategoryDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface PropertyTypeDefinition {
  readonly id: string;
  readonly category_id: string;
  readonly label: string;
  readonly description: string;
  readonly min_bedrooms: number;
  readonly max_bedrooms: number;
  readonly max_occupants: number;
  readonly min_owner_age: number;
  readonly allowed_uses: readonly string[];
  readonly is_commercial: boolean;
}

export interface PropertyLocationDefinition {
  readonly id: string;
  readonly label: string;
  readonly state_id: string;
  readonly lga_id: string;
  readonly settlement: string;
  readonly neighborhood: string;
  readonly price_multiplier: number;
  readonly rent_multiplier: number;
  readonly demand: "low" | "moderate" | "high" | "very_high";
}

export interface SeedPropertyDefinition {
  readonly id: string;
  readonly type_id: string;
  readonly location_id: string;
  readonly name: string;
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly condition: PropertyCondition;
  readonly size_sqm: number;
  readonly base_price_ngn: number;
  readonly base_rent_ngn: number;
  readonly rent_period: PropertyRentPeriod;
  readonly deposit_ngn: number;
  readonly amenities: readonly string[];
  readonly owner_kind: PropertyOwnershipKind;
  readonly owner_id: string;
  readonly listed_for_sale: boolean;
  readonly listed_for_rent: boolean;
  readonly sale_price_ngn: number;
  readonly rent_price_ngn: number;
}

export interface FurnitureDefinition {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly price_ngn: number;
  readonly space: number;
}

export interface PropertyRules {
  readonly currency: string;
  readonly currency_label: string;
  readonly currency_symbol: string;
  readonly minimum_purchase_age_years: number;
  readonly maximum_properties_per_character: number;
  readonly maximum_land_per_character: number;
  readonly maximum_active_rental_agreements_per_tenant: number;
  readonly minimum_rent_period_months: number;
  readonly maximum_rent_period_months: number;
  readonly minimum_deposit_percent: number;
  readonly maximum_deposit_percent: number;
  readonly minimum_property_price_ngn: number;
  readonly maximum_property_price_ngn: number;
  readonly minimum_rent_price_ngn: number;
  readonly maximum_rent_price_ngn: number;
  readonly minimum_land_size_sqm: number;
  readonly maximum_land_size_sqm: number;
  readonly maintenance_cost_multiplier_percent: number;
  readonly listing_idempotency_window_seconds: number;
  readonly transaction_idempotency_window_seconds: number;
  readonly maximum_ownership_history_entries: number;
  readonly maximum_furniture_per_property: number;
  readonly maximum_maintenance_records_per_property: number;
  readonly property_condition_levels: readonly PropertyCondition[];
  readonly starting_condition: PropertyCondition;
  readonly development_statuses: readonly PropertyDevelopmentStatus[];
}

export interface PropertyCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly property_categories: readonly PropertyCategoryDefinition[];
  readonly property_types: readonly PropertyTypeDefinition[];
  readonly property_locations: readonly PropertyLocationDefinition[];
  readonly seed_properties: readonly SeedPropertyDefinition[];
  readonly furniture_catalog: readonly FurnitureDefinition[];
  readonly rules: PropertyRules;
}

// ─── Persistent record types ──────────────────────────────────────

export interface PropertyRecord {
  readonly property_id: string;
  readonly type_id: string;
  readonly category_id: string;
  readonly location_id: string;
  name: string;
  description: string;
  bedrooms: number;
  bathrooms: number;
  condition: PropertyCondition;
  size_sqm: number;
  amenities: string[];
  development_status: PropertyDevelopmentStatus;
  is_land: boolean;
  is_commercial: boolean;
  max_occupants: number;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface PropertyOwnershipRecord {
  readonly ownership_id: string;
  readonly property_id: string;
  readonly owner_kind: PropertyOwnershipKind;
  readonly owner_id: string;
  share_percent: number;
  acquisition_date: string;
  acquisition_world_date: CalendarDate;
  acquisition_price_ngn: number;
  active: boolean;
  end_date: string | null;
  end_world_date: CalendarDate | null;
  end_reason: string | null;
  updated_at: string;
}

export interface PropertyListingRecord {
  readonly listing_id: string;
  readonly property_id: string;
  readonly owner_id: string;
  listing_type: PropertyListingType;
  asking_price_ngn: number;
  rent_price_ngn: number;
  rent_period: PropertyRentPeriod;
  deposit_ngn: number;
  available: boolean;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
  idempotency_key: string;
}

export interface RentalAgreementRecord {
  readonly agreement_id: string;
  readonly property_id: string;
  readonly listing_id: string;
  readonly landlord_id: string;
  readonly landlord_kind: PropertyOwnershipKind;
  readonly tenant_id: string;
  rent_ngn: number;
  rent_period: PropertyRentPeriod;
  deposit_ngn: number;
  start_date: string;
  start_world_date: CalendarDate;
  end_date: string | null;
  end_world_date: CalendarDate | null;
  status: RentalAgreementStatus;
  total_paid_ngn: number;
  last_payment_date: string | null;
  last_payment_world_date: CalendarDate | null;
  created_at: string;
  updated_at: string;
}

export interface RentalPaymentRecord {
  readonly payment_id: string;
  readonly agreement_id: string;
  readonly property_id: string;
  readonly tenant_id: string;
  readonly landlord_id: string;
  amount_ngn: number;
  period_start: string;
  period_end: string;
  payment_date: string;
  payment_world_date: CalendarDate;
  idempotency_key: string;
}

export interface PropertySaleRecord {
  readonly sale_id: string;
  readonly property_id: string;
  readonly listing_id: string;
  readonly seller_id: string;
  readonly seller_kind: PropertyOwnershipKind;
  readonly buyer_id: string;
  amount_ngn: number;
  sale_date: string;
  sale_world_date: CalendarDate;
  idempotency_key: string;
}

export interface PropertyMaintenanceRecord {
  readonly maintenance_id: string;
  readonly property_id: string;
  readonly requested_by: string;
  description: string;
  cost_ngn: number;
  condition_before: PropertyCondition;
  condition_after: PropertyCondition;
  status: "pending" | "completed" | "cancelled";
  created_at: string;
  created_world_date: CalendarDate;
  completed_at: string | null;
}

export interface PropertyFurnishingRecord {
  readonly furnishing_id: string;
  readonly property_id: string;
  readonly furniture_definition_id: string;
  quantity: number;
  placed_at: string;
  updated_at: string;
}

export interface PropertyEventRecord {
  readonly event_id: string;
  readonly property_id: string;
  readonly type: string;
  readonly world_date: CalendarDate;
  summary: string;
  details: Record<string, string | number | boolean | null>;
  created_at: string;
}

// ─── Persistence map type ─────────────────────────────────────────

export interface PersistentPropertyMaps {
  properties: Record<string, PropertyRecord>;
  propertyOwnership: Record<string, PropertyOwnershipRecord>;
  propertyListings: Record<string, PropertyListingRecord>;
  rentalAgreements: Record<string, RentalAgreementRecord>;
  rentalPayments: Record<string, RentalPaymentRecord>;
  propertySales: Record<string, PropertySaleRecord>;
  propertyMaintenance: Record<string, PropertyMaintenanceRecord>;
  propertyFurnishings: Record<string, PropertyFurnishingRecord>;
  propertyEvents: Record<string, PropertyEventRecord>;
}

// ─── Snapshot types for the authenticated character ───────────────

export interface PropertyProfileSnapshot {
  readonly property_id: string;
  readonly type_id: string;
  readonly category_id: string;
  readonly location_id: string;
  readonly name: string;
  readonly description: string;
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly condition: PropertyCondition;
  readonly size_sqm: number;
  readonly amenities: readonly string[];
  readonly development_status: PropertyDevelopmentStatus;
  readonly is_land: boolean;
  readonly is_commercial: boolean;
  readonly max_occupants: number;
  readonly ownership: PropertyOwnershipRecord;
  readonly active_listing: PropertyListingRecord | null;
  readonly active_rental: RentalAgreementRecord | null;
  readonly furnishing: readonly PropertyFurnishingRecord[];
  readonly recent_events: readonly PropertyEventRecord[];
}

export interface PropertyListingSnapshot {
  readonly listing_id: string;
  readonly property_id: string;
  readonly type_id: string;
  readonly category_id: string;
  readonly location_id: string;
  readonly location_label: string;
  readonly name: string;
  readonly description: string;
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly condition: PropertyCondition;
  readonly size_sqm: number;
  readonly amenities: readonly string[];
  readonly listing_type: PropertyListingType;
  readonly asking_price_ngn: number;
  readonly rent_price_ngn: number;
  readonly rent_period: PropertyRentPeriod;
  readonly deposit_ngn: number;
  readonly available: boolean;
  readonly owner_id: string;
  readonly owner_kind: PropertyOwnershipKind;
}

export interface RentalAgreementSnapshot {
  readonly agreement_id: string;
  readonly property_id: string;
  readonly property_name: string;
  readonly location_id: string;
  readonly landlord_id: string;
  readonly tenant_id: string;
  readonly rent_ngn: number;
  readonly rent_period: PropertyRentPeriod;
  readonly deposit_ngn: number;
  readonly start_date: string;
  readonly end_date: string | null;
  readonly status: RentalAgreementStatus;
  readonly total_paid_ngn: number;
}

export interface PropertyMarketSnapshot {
  readonly listings: readonly PropertyListingSnapshot[];
  readonly total_for_sale: number;
  readonly total_for_rent: number;
  readonly catalog_locations: readonly PropertyLocationDefinition[];
  readonly catalog_types: readonly PropertyTypeDefinition[];
}
