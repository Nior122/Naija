import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GovernmentCatalog } from "./types.js";

const CATALOG_FILE = "game/data/government/catalog.json";

function repositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(candidate, CATALOG_FILE))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not locate ${CATALOG_FILE}; the government catalogue is required.`);
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

function validateCatalog(value: unknown): GovernmentCatalog {
  if (!isRecord(value) || value.schema_version !== 1 || value.world_id !== "nigeria-main" ||
    typeof value.notice !== "string" || value.notice.length < 30 ||
    !isRecord(value.rules) ||
    !Array.isArray(value.government_levels) || !Array.isArray(value.federal_ministries) ||
    !Array.isArray(value.project_categories) || !Array.isArray(value.budget_categories) ||
    !Array.isArray(value.revenue_categories) || !Array.isArray(value.expenditure_categories) ||
    !Array.isArray(value.seed_offices)) {
    throw new Error("Government catalogue is incomplete or has an unsupported schema/world.");
  }
  const catalog = value as unknown as GovernmentCatalog;

  uniqueIds(catalog.government_levels, "Government levels");
  uniqueIds(catalog.federal_ministries, "Federal ministries");
  uniqueIds(catalog.project_categories, "Project categories");
  uniqueIds(catalog.budget_categories, "Budget categories");
  uniqueIds(catalog.revenue_categories, "Revenue categories");
  uniqueIds(catalog.expenditure_categories, "Expenditure categories");
  uniqueIds(catalog.seed_offices, "Seed offices");

  const rules = catalog.rules;
  if (rules.currency !== "NGN" || typeof rules.currency_label !== "string" || typeof rules.currency_symbol !== "string") {
    throw new Error("Government rules must use NGN currency.");
  }
  if (rules.minimum_office_holder_age < 0 || rules.minimum_office_holder_age > 100) {
    throw new Error("Government rules have invalid minimum office-holder age.");
  }
  if (rules.maximum_budget_amount_ngn < rules.minimum_budget_amount_ngn) {
    throw new Error("Government rules have invalid budget bounds.");
  }
  if (rules.project_statuses.length < 3) {
    throw new Error("Government rules must define at least 3 project statuses.");
  }

  return catalog;
}

let cached: GovernmentCatalog | null = null;

export function loadGovernmentCatalog(): GovernmentCatalog {
  if (cached) return cached;
  const root = repositoryRoot();
  const filePath = resolve(root, CATALOG_FILE);
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  cached = validateCatalog(parsed);
  return cached;
}

export function validateGovernmentCatalogForTest(value: unknown): GovernmentCatalog {
  return validateCatalog(value);
}
