import type { CalendarDate } from "../life/types.js";

export type BusinessCategoryCode = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";
export type BusinessModel = "retail" | "food_service" | "service" | "production";
export type BusinessStatus = "draft" | "active" | "suspended" | "closed" | "insolvent";
export type BusinessOwnershipRole = "owner" | "co_owner" | "manager" | "accountant" | "inventory_manager" | "employee";
export type BusinessPremisesType = "home_based" | "market_stall" | "shop" | "office" | "workshop" | "restaurant" | "farm" | "warehouse" | "factory" | "service_area" | "studio";
export type BusinessTransactionKind = "sale_product" | "sale_service" | "expense_operating" | "expense_rent" | "expense_salary" | "capital_contribution" | "owner_withdrawal" | "production_cost" | "setup_cost" | "refund" | "purchase_stock";
export type BusinessInventoryMovementKind = "initial_stock" | "restock" | "sale" | "production_output" | "production_input" | "adjustment" | "damage" | "transfer";

export interface BusinessCategoryDefinition {
  readonly id: string;
  readonly label: string;
  readonly code: BusinessCategoryCode;
}

export interface BusinessTemplateDefinition {
  readonly id: string;
  readonly category_id: string;
  readonly label: string;
  readonly description: string;
  readonly model: BusinessModel;
  readonly default_premises: BusinessPremisesType;
  readonly allowed_locations: readonly string[];
  readonly setup_cost_ngn: number;
  readonly monthly_operating_cost_ngn: number;
  readonly rent_cost_ngn: number;
  readonly maximum_employees: number;
  readonly minimum_owner_age: number;
  readonly requires_inventory: boolean;
  readonly requires_production: boolean;
  readonly production_recipes: readonly string[];
  readonly active: boolean;
}

export interface BusinessProductDefinition {
  readonly id: string;
  readonly category: string;
  readonly label: string;
  readonly base_cost_ngn: number;
  readonly base_price_ngn: number;
  readonly unit: string;
}

export interface BusinessProductionRecipeDefinition {
  readonly id: string;
  readonly label: string;
  readonly output_product_id: string;
  readonly output_quantity: number;
  readonly inputs: readonly { readonly product_id: string; readonly quantity: number }[];
  readonly duration_minutes: number;
  readonly operating_cost_ngn: number;
  readonly active: boolean;
}

export interface BusinessRules {
  readonly maximum_businesses_per_character: number;
  readonly maximum_branches_per_business: number;
  readonly maximum_employees_per_business: number;
  readonly maximum_products_per_business: number;
  readonly maximum_stock_per_product: number;
  readonly minimum_stock_reorder_threshold: number;
  readonly maximum_business_name_length: number;
  readonly minimum_business_name_length: number;
  readonly maximum_business_description_length: number;
  readonly minimum_owner_age_years: number;
  readonly maximum_price_markup_percent: number;
  readonly minimum_price_markup_percent: number;
  readonly maximum_owner_withdrawal_ngn: number;
  readonly maximum_capital_contribution_ngn: number;
  readonly maximum_reputation_score: number;
  readonly starting_reputation_score: number;
  readonly minimum_reputation_score: number;
  readonly maximum_pending_obligations: number;
  readonly business_operating_day_minutes: number;
}

export interface BusinessCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly rules: BusinessRules;
  readonly categories: readonly BusinessCategoryDefinition[];
  readonly premises_types: readonly BusinessPremisesType[];
  readonly templates: readonly BusinessTemplateDefinition[];
  readonly business_products: readonly BusinessProductDefinition[];
  readonly production_recipes: readonly BusinessProductionRecipeDefinition[];
}

export interface BusinessOwnershipRecord {
  readonly ownership_id: string;
  readonly business_id: string;
  readonly character_id: string;
  role: BusinessOwnershipRole;
  share_percent: number;
  readonly created_at: string;
  readonly created_world_date: CalendarDate;
  updated_at: string;
  is_founder: boolean;
  active: boolean;
}

export interface BusinessRecord {
  readonly business_id: string;
  name: string;
  description: string;
  readonly template_id: string;
  readonly category_id: string;
  readonly model: BusinessModel;
  status: BusinessStatus;
  readonly primary_location_id: string;
  premises_type: BusinessPremisesType;
  reputation_score: number;
  total_revenue_ngn: number;
  total_expenses_ngn: number;
  total_capital_ngn: number;
  total_withdrawals_ngn: number;
  balance_ngn: number;
  readonly created_at: string;
  readonly created_world_date: CalendarDate;
  updated_at: string;
  last_operating_date: CalendarDate | null;
  readonly owner_character_id: string;
  closed_at: string | null;
  closed_world_date: CalendarDate | null;
  closure_reason: string | null;
}

export interface BusinessBranchRecord {
  readonly branch_id: string;
  readonly business_id: string;
  name: string;
  readonly location_id: string;
  premises_type: BusinessPremisesType;
  status: BusinessStatus;
  readonly created_at: string;
  readonly created_world_date: CalendarDate;
  updated_at: string;
}

export interface BusinessProductRecord {
  readonly product_record_id: string;
  readonly business_id: string;
  readonly product_definition_id: string;
  display_name: string;
  price_ngn: number;
  available: boolean;
  readonly created_at: string;
  updated_at: string;
}

export interface BusinessInventoryRecord {
  readonly inventory_id: string;
  readonly business_id: string;
  readonly product_definition_id: string;
  readonly location_id: string;
  quantity: number;
  unit_cost_ngn: number;
  reorder_threshold: number;
  updated_at: string;
}

export interface BusinessInventoryMovementRecord {
  readonly movement_id: string;
  readonly business_id: string;
  readonly inventory_id: string;
  readonly product_definition_id: string;
  readonly kind: BusinessInventoryMovementKind;
  readonly quantity: number;
  readonly location_id: string;
  readonly world_date: CalendarDate;
  readonly minute_of_day: number;
  readonly posted_at: string;
  readonly reference_id: string | null;
  readonly description: string;
}

export interface BusinessTransactionRecord {
  readonly transaction_id: string;
  readonly business_id: string;
  readonly kind: BusinessTransactionKind;
  readonly amount_ngn: number;
  readonly balance_before_ngn: number;
  readonly balance_after_ngn: number;
  readonly description: string;
  readonly world_date: CalendarDate;
  readonly minute_of_day: number;
  readonly posted_at: string;
  readonly reference_id: string | null;
  readonly counterparty_character_id: string | null;
  readonly idempotency_key: string;
}

export interface BusinessExpenseRecord {
  readonly expense_id: string;
  readonly business_id: string;
  readonly kind: string;
  readonly amount_ngn: number;
  readonly description: string;
  readonly due_world_date: CalendarDate;
  readonly paid: boolean;
  readonly paid_at: string | null;
  readonly paid_world_date: CalendarDate | null;
  readonly created_at: string;
  updated_at: string;
}

export interface BusinessSaleRecord {
  readonly sale_id: string;
  readonly business_id: string;
  readonly product_record_id: string | null;
  readonly product_definition_id: string;
  readonly buyer_character_id: string | null;
  readonly quantity: number;
  readonly unit_price_ngn: number;
  readonly total_ngn: number;
  readonly world_date: CalendarDate;
  readonly minute_of_day: number;
  readonly posted_at: string;
  readonly is_service: boolean;
}

export interface BusinessProductionRunRecord {
  readonly run_id: string;
  readonly business_id: string;
  readonly recipe_id: string;
  readonly output_product_id: string;
  readonly output_quantity: number;
  readonly operating_cost_ngn: number;
  readonly world_date: CalendarDate;
  readonly minute_of_day: number;
  readonly posted_at: string;
  readonly completed: boolean;
  readonly input_movements: readonly string[];
  readonly output_movement_id: string | null;
}

export interface BusinessReputationEntry {
  readonly score: number;
  readonly reason: string;
  readonly world_date: CalendarDate;
  readonly recorded_at: string;
}

export interface BusinessEventRecord {
  readonly event_id: string;
  readonly business_id: string;
  readonly type: string;
  readonly world_date: CalendarDate;
  readonly minute_of_day: number;
  readonly summary: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
  readonly created_at: string;
}

export interface PersistentBusinessMaps {
  businesses: Record<string, BusinessRecord>;
  businessOwnership: Record<string, BusinessOwnershipRecord>;
  businessBranches: Record<string, BusinessBranchRecord>;
  businessProducts: Record<string, BusinessProductRecord>;
  businessInventory: Record<string, BusinessInventoryRecord>;
  businessInventoryMovements: Record<string, BusinessInventoryMovementRecord>;
  businessTransactions: Record<string, BusinessTransactionRecord>;
  businessExpenses: Record<string, BusinessExpenseRecord>;
  businessSales: Record<string, BusinessSaleRecord>;
  businessProductionRuns: Record<string, BusinessProductionRunRecord>;
  businessEvents: Record<string, BusinessEventRecord>;
}

export interface BusinessProfileSnapshot {
  readonly schema_version: 1;
  readonly business_id: string;
  readonly name: string;
  readonly description: string;
  readonly template_id: string;
  readonly template_label: string;
  readonly category_id: string;
  readonly category_label: string;
  readonly model: BusinessModel;
  readonly status: BusinessStatus;
  readonly primary_location_id: string;
  readonly premises_type: BusinessPremisesType;
  readonly reputation_score: number;
  readonly balance_ngn: number;
  readonly total_revenue_ngn: number;
  readonly total_expenses_ngn: number;
  readonly total_capital_ngn: number;
  readonly total_withdrawals_ngn: number;
  readonly owners: readonly BusinessOwnershipRecord[];
  readonly branches: readonly BusinessBranchRecord[];
  readonly products: readonly BusinessProductRecord[];
  readonly inventory: readonly BusinessInventoryRecord[];
  readonly recent_transactions: readonly BusinessTransactionRecord[];
  readonly recent_sales: readonly BusinessSaleRecord[];
  readonly recent_events: readonly BusinessEventRecord[];
  readonly pending_expenses: readonly BusinessExpenseRecord[];
}

export interface BusinessDiscoveryEntry {
  readonly business_id: string;
  readonly name: string;
  readonly description: string;
  readonly template_id: string;
  readonly template_label: string;
  readonly category_id: string;
  readonly category_label: string;
  readonly model: BusinessModel;
  readonly status: BusinessStatus;
  readonly location_id: string;
  readonly reputation_score: number;
  readonly product_count: number;
  readonly employee_count: number;
}
