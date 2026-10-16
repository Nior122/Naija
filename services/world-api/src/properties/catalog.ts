import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PropertyCatalog, PropertyCondition } from "./types.js";

const CATALOG_FILE = "game/data/properties/catalog.json";

const VALID_CONDITIONS = new Set<PropertyCondition>(["excellent", "good", "fair", "poor", "requires_repair"]);

function repositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(candidate, CATALOG_FILE))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not locate ${CATALOG_FILE}; the property catalogue is required.`);
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

function validateCatalog(value: unknown): PropertyCatalog {
  if (!isRecord(value) || value.schema_version !== 1 || value.world_id !== "nigeria-main" ||
    typeof value.notice !== "string" || value.notice.length < 30 ||
    !isRecord(value.rules) ||
    !Array.isArray(value.property_categories) || !Array.isArray(value.property_types) ||
    !Array.isArray(value.property_locations) || !Array.isArray(value.seed_properties) ||
    !Array.isArray(value.furniture_catalog)) {
    throw new Error("Property catalogue is incomplete or has an unsupported schema/world.");
  }
  const catalog = value as unknown as PropertyCatalog;

  uniqueIds(catalog.property_categories, "Property categories");
  uniqueIds(catalog.property_types, "Property types");
  uniqueIds(catalog.property_locations, "Property locations");
  uniqueIds(catalog.seed_properties, "Seed properties");
  uniqueIds(catalog.furniture_catalog, "Furniture catalogue");

  const locationIds = new Set(catalog.property_locations.map((l) => l.id));
  const typeIds = new Set(catalog.property_types.map((t) => t.id));
  const categoryIds = new Set(catalog.property_categories.map((c) => c.id));

  for (const type of catalog.property_types) {
    if (!categoryIds.has(type.category_id)) throw new Error(`Property type '${type.id}' references unknown category '${type.category_id}'.`);
    if (type.min_bedrooms < 0 || type.max_bedrooms < type.min_bedrooms || type.max_bedrooms > 20) {
      throw new Error(`Property type '${type.id}' has invalid bedroom bounds.`);
    }
    if (type.max_occupants < 0 || type.max_occupants > 200) {
      throw new Error(`Property type '${type.id}' has invalid occupant limit.`);
    }
    if (type.min_owner_age < 0 || type.min_owner_age > 100) {
      throw new Error(`Property type '${type.id}' has invalid minimum owner age.`);
    }
  }

  for (const location of catalog.property_locations) {
    if (!location.state_id || location.state_id.length > 10) throw new Error(`Property location '${location.id}' has invalid state_id.`);
    if (!location.lga_id || location.lga_id.length > 80) throw new Error(`Property location '${location.id}' has invalid lga_id.`);
    if (location.price_multiplier < 0.1 || location.price_multiplier > 100) {
      throw new Error(`Property location '${location.id}' has out-of-range price multiplier.`);
    }
    if (location.rent_multiplier < 0.1 || location.rent_multiplier > 100) {
      throw new Error(`Property location '${location.id}' has out-of-range rent multiplier.`);
    }
  }

  for (const seed of catalog.seed_properties) {
    if (!typeIds.has(seed.type_id)) throw new Error(`Seed property '${seed.id}' references unknown type '${seed.type_id}'.`);
    if (!locationIds.has(seed.location_id)) throw new Error(`Seed property '${seed.id}' references unknown location '${seed.location_id}'.`);
    if (!VALID_CONDITIONS.has(seed.condition)) throw new Error(`Seed property '${seed.id}' has invalid condition.`);
    if (seed.size_sqm < 0 || seed.size_sqm > 1_000_000) throw new Error(`Seed property '${seed.id}' has invalid size.`);
    if (seed.base_price_ngn < 0 || seed.base_price_ngn > 10_000_000_000) throw new Error(`Seed property '${seed.id}' has invalid price.`);
  }

  for (const furniture of catalog.furniture_catalog) {
    if (furniture.price_ngn < 0 || furniture.price_ngn > 100_000_000) {
      throw new Error(`Furniture '${furniture.id}' has invalid price.`);
    }
    if (furniture.space < 0 || furniture.space > 100) {
      throw new Error(`Furniture '${furniture.id}' has invalid space.`);
    }
  }

  const rules = catalog.rules;
  if (rules.currency !== "NGN" || typeof rules.currency_label !== "string" || typeof rules.currency_symbol !== "string") {
    throw new Error("Property rules must use NGN currency.");
  }
  if (rules.minimum_purchase_age_years < 0 || rules.minimum_purchase_age_years > 100) {
    throw new Error("Property rules have invalid minimum purchase age.");
  }
  if (rules.maximum_properties_per_character < 1 || rules.maximum_properties_per_character > 1000) {
    throw new Error("Property rules have invalid max properties per character.");
  }
  if (rules.minimum_property_price_ngn < 1 || rules.maximum_property_price_ngn < rules.minimum_property_price_ngn) {
    throw new Error("Property rules have invalid price bounds.");
  }
  if (rules.minimum_rent_price_ngn < 0 || rules.maximum_rent_price_ngn < rules.minimum_rent_price_ngn) {
    throw new Error("Property rules have invalid rent bounds.");
  }

  return catalog;
}

let cached: PropertyCatalog | null = null;

export function loadPropertyCatalog(): PropertyCatalog {
  if (cached) return cached;
  const root = repositoryRoot();
  const filePath = resolve(root, CATALOG_FILE);
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  cached = validateCatalog(parsed);
  return cached;
}

export function validatePropertyCatalogForTest(value: unknown): PropertyCatalog {
  return validateCatalog(value);
}
