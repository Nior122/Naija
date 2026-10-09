import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BusinessCatalog, BusinessModel, BusinessPremisesType } from "./types.js";

const CATALOG_FILE = "game/data/businesses/catalog.json";
const BUSINESS_MODELS = new Set<BusinessModel>(["retail", "food_service", "service", "production"]);
const PREMISES_TYPES = new Set<BusinessPremisesType>([
  "home_based", "market_stall", "shop", "office", "workshop", "restaurant", "farm", "warehouse", "factory", "service_area", "studio",
]);
const VALID_LOCATIONS = new Set([
  "town", "home", "schoolyard", "classroom", "campus", "training_center", "market", "clinic",
  "police_station", "community_hall",
]);

function repositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(candidate, CATALOG_FILE))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not locate ${CATALOG_FILE}; the business catalog is required.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueIds(values: readonly { readonly id: string }[], label: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (!value.id || value.id.length > 120 || ids.has(value.id)) throw new Error(`${label} has a missing or duplicate ID.`);
    ids.add(value.id);
  }
}

function validateCatalog(value: unknown): BusinessCatalog {
  if (!isRecord(value) || value.schema_version !== 1 || value.world_id !== "nigeria-main" ||
    typeof value.notice !== "string" || value.notice.length < 30 || !isRecord(value.rules) ||
    !Array.isArray(value.categories) || !Array.isArray(value.premises_types) ||
    !Array.isArray(value.templates) || !Array.isArray(value.business_products) ||
    !Array.isArray(value.production_recipes)) {
    throw new Error("Business catalog is incomplete or has an unsupported schema/world.");
  }
  const catalog = value as unknown as BusinessCatalog;
  uniqueIds(catalog.categories, "Business categories");
  uniqueIds(catalog.templates, "Business templates");
  uniqueIds(catalog.business_products, "Business products");
  uniqueIds(catalog.production_recipes, "Business production recipes");

  const rules = catalog.rules;
  if (!Number.isSafeInteger(rules.maximum_businesses_per_character) || rules.maximum_businesses_per_character < 1 || rules.maximum_businesses_per_character > 20 ||
    !Number.isSafeInteger(rules.maximum_branches_per_business) || rules.maximum_branches_per_business < 0 || rules.maximum_branches_per_business > 50 ||
    !Number.isSafeInteger(rules.maximum_employees_per_business) || rules.maximum_employees_per_business < 0 || rules.maximum_employees_per_business > 500 ||
    !Number.isSafeInteger(rules.maximum_products_per_business) || rules.maximum_products_per_business < 1 || rules.maximum_products_per_business > 1000 ||
    !Number.isSafeInteger(rules.maximum_stock_per_product) || rules.maximum_stock_per_product < 1 || rules.maximum_stock_per_product > 1000000 ||
    !Number.isSafeInteger(rules.minimum_stock_reorder_threshold) || rules.minimum_stock_reorder_threshold < 0 || rules.minimum_stock_reorder_threshold > rules.maximum_stock_per_product ||
    !Number.isSafeInteger(rules.maximum_business_name_length) || rules.maximum_business_name_length < 2 || rules.maximum_business_name_length > 200 ||
    !Number.isSafeInteger(rules.minimum_business_name_length) || rules.minimum_business_name_length < 1 || rules.minimum_business_name_length > rules.maximum_business_name_length ||
    !Number.isSafeInteger(rules.maximum_business_description_length) || rules.maximum_business_description_length < 10 || rules.maximum_business_description_length > 2000 ||
    !Number.isSafeInteger(rules.minimum_owner_age_years) || rules.minimum_owner_age_years < 16 || rules.minimum_owner_age_years > 65 ||
    !Number.isSafeInteger(rules.maximum_price_markup_percent) || rules.maximum_price_markup_percent < 1 || rules.maximum_price_markup_percent > 5000 ||
    !Number.isSafeInteger(rules.minimum_price_markup_percent) || rules.minimum_price_markup_percent < 1 || rules.minimum_price_markup_percent > rules.maximum_price_markup_percent ||
    !Number.isSafeInteger(rules.maximum_owner_withdrawal_ngn) || rules.maximum_owner_withdrawal_ngn < 1 ||
    !Number.isSafeInteger(rules.maximum_capital_contribution_ngn) || rules.maximum_capital_contribution_ngn < 1 ||
    !Number.isSafeInteger(rules.maximum_reputation_score) || rules.maximum_reputation_score < 1 || rules.maximum_reputation_score > 1000 ||
    !Number.isSafeInteger(rules.starting_reputation_score) || rules.starting_reputation_score < 0 || rules.starting_reputation_score > rules.maximum_reputation_score ||
    !Number.isSafeInteger(rules.minimum_reputation_score) || rules.minimum_reputation_score < 0 || rules.minimum_reputation_score >= rules.maximum_reputation_score ||
    !Number.isSafeInteger(rules.maximum_pending_obligations) || rules.maximum_pending_obligations < 1 || rules.maximum_pending_obligations > 1000 ||
    !Number.isSafeInteger(rules.business_operating_day_minutes) || rules.business_operating_day_minutes < 60 || rules.business_operating_day_minutes > 1440) {
    throw new Error("Business rules contain invalid bounds.");
  }

  const categoryIds = new Set(catalog.categories.map((cat) => cat.id));
  const productIds = new Set(catalog.business_products.map((p) => p.id));
  const recipeIds = new Set(catalog.production_recipes.map((r) => r.id));

  for (const template of catalog.templates) {
    if (!categoryIds.has(template.category_id) || !template.label || !template.description ||
      !BUSINESS_MODELS.has(template.model) || !PREMISES_TYPES.has(template.default_premises) ||
      !Array.isArray(template.allowed_locations) || template.allowed_locations.length === 0 ||
      template.allowed_locations.some((loc) => !VALID_LOCATIONS.has(loc)) ||
      !Number.isSafeInteger(template.setup_cost_ngn) || template.setup_cost_ngn < 0 || template.setup_cost_ngn > 100000000 ||
      !Number.isSafeInteger(template.monthly_operating_cost_ngn) || template.monthly_operating_cost_ngn < 0 ||
      !Number.isSafeInteger(template.rent_cost_ngn) || template.rent_cost_ngn < 0 ||
      !Number.isSafeInteger(template.maximum_employees) || template.maximum_employees < 0 ||
      !Number.isSafeInteger(template.minimum_owner_age) || template.minimum_owner_age < 16 || template.minimum_owner_age > 65 ||
      typeof template.requires_inventory !== "boolean" || typeof template.requires_production !== "boolean" ||
      !Array.isArray(template.production_recipes) || template.production_recipes.some((id) => !recipeIds.has(id)) ||
      typeof template.active !== "boolean") {
      throw new Error(`Business template ${template.id} has invalid configuration.`);
    }
    if (template.requires_production && template.production_recipes.length === 0) {
      throw new Error(`Business template ${template.id} requires production but has no recipes.`);
    }
  }

  for (const product of catalog.business_products) {
    if (!product.category || !product.label || !product.unit ||
      !Number.isSafeInteger(product.base_cost_ngn) || product.base_cost_ngn < 0 || product.base_cost_ngn > 50000000 ||
      !Number.isSafeInteger(product.base_price_ngn) || product.base_price_ngn < 0 || product.base_price_ngn > 50000000) {
      throw new Error(`Business product ${product.id} has invalid configuration.`);
    }
  }

  for (const recipe of catalog.production_recipes) {
    if (!recipe.label || !productIds.has(recipe.output_product_id) ||
      !Number.isSafeInteger(recipe.output_quantity) || recipe.output_quantity < 1 || recipe.output_quantity > 10000 ||
      !Array.isArray(recipe.inputs) || recipe.inputs.some((input) => !productIds.has(input.product_id) || !Number.isSafeInteger(input.quantity) || input.quantity < 1) ||
      !Number.isSafeInteger(recipe.duration_minutes) || recipe.duration_minutes < 1 || recipe.duration_minutes > 10000 ||
      !Number.isSafeInteger(recipe.operating_cost_ngn) || recipe.operating_cost_ngn < 0 ||
      typeof recipe.active !== "boolean") {
      throw new Error(`Business recipe ${recipe.id} has invalid configuration.`);
    }
  }

  return catalog;
}

let cachedCatalog: BusinessCatalog | null = null;

export function loadBusinessCatalog(): BusinessCatalog {
  if (cachedCatalog !== null) return cachedCatalog;
  const configuredDirectory = process.env.NAIJA_BUSINESSES_DATA_DIR;
  const filePath = configuredDirectory ? resolve(configuredDirectory, "catalog.json") : join(repositoryRoot(), CATALOG_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Could not load business catalog at ${filePath}.`, { cause: error });
  }
  cachedCatalog = validateCatalog(parsed);
  return cachedCatalog;
}

export function validateBusinessCatalogForTest(value: unknown): BusinessCatalog {
  return validateCatalog(value);
}
