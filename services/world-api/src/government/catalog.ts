import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INSTITUTIONS, OFFICE_SCOPES, SCOPE_LEVEL, TREASURY_PERMISSIONS } from "./hierarchy.js";
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
    !Array.isArray(value.seed_offices) || !Array.isArray(value.independent_institutions) ||
    !Array.isArray(value.treasury_funding) || !isRecord(value.office_permissions)) {
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
  if (!Number.isSafeInteger(rules.budget_approval_minimum_age_years) ||
    rules.budget_approval_minimum_age_years < rules.minimum_office_holder_age || rules.budget_approval_minimum_age_years > 100) {
    throw new Error("Government rules have an invalid budget-approval minimum age.");
  }
  if (!catalog.budget_categories.some((c) => c.id === rules.ministry_budget_category_id)) {
    throw new Error("Government rules name an unknown ministry budget category.");
  }

  // Treasury funding (Stage 32): each rule is a fixed, finite amount into one treasury, with a revenue category that
  // exists. A rule is applied once per world, so its ID must be unique and its amount within the revenue bounds.
  uniqueIds(catalog.treasury_funding.map((rule) => ({ id: rule.rule_id })), "Treasury funding rules");
  for (const rule of catalog.treasury_funding) {
    if (!rule.organisation_id.startsWith("gov:") || typeof rule.reason !== "string" || rule.reason.trim().length === 0) {
      throw new Error(`Treasury funding rule ${rule.rule_id} needs a government organisation and a reason.`);
    }
    if (!Number.isSafeInteger(rule.amount_ngn) || rule.amount_ngn < rules.minimum_revenue_amount_ngn ||
      rule.amount_ngn > rules.maximum_revenue_amount_ngn) {
      throw new Error(`Treasury funding rule ${rule.rule_id} has an amount outside the revenue bounds.`);
    }
    if (!catalog.revenue_categories.some((c) => c.id === rule.category_id)) {
      throw new Error(`Treasury funding rule ${rule.rule_id} names an unknown revenue category.`);
    }
  }

  // Hierarchy (Stage 31): every office names a scope that matches its level, an institution, and a seed placement.
  const seedIds = new Set<string>();
  for (const office of catalog.seed_offices) {
    seedIds.add(office.id);
    if (!OFFICE_SCOPES.includes(office.scope) || SCOPE_LEVEL[office.scope] !== office.level) {
      throw new Error(`Government office ${office.id} has a scope that does not match its level.`);
    }
    if (!INSTITUTIONS.includes(office.institution)) throw new Error(`Government office ${office.id} has an unknown institution.`);
    if ((office.institution === "electoral") !== (office.scope === "electoral_commission")) {
      throw new Error(`Government office ${office.id} mixes an electoral institution with another scope.`);
    }
    if (office.seed_organisation === "per_ministry" && office.scope !== "federal_ministry") {
      throw new Error(`Government office ${office.id} can be seeded per ministry only with a ministry scope.`);
    }
    if (office.seed_organisation !== null && !["gov:federal", "gov:electoral", "per_ministry"].includes(office.seed_organisation)) {
      throw new Error(`Government office ${office.id} has an unknown seed organisation.`);
    }
  }
  const institutionIds = new Set<string>();
  for (const institution of catalog.independent_institutions) {
    if (institutionIds.has(institution.id)) throw new Error("Independent institutions have a duplicate ID.");
    institutionIds.add(institution.id);
    if (!institution.organisation_id.startsWith("gov:") || institution.level !== "federal") {
      throw new Error(`Independent institution ${institution.id} must be a federal government organisation.`);
    }
  }
  for (const [officeId, permissions] of Object.entries(catalog.office_permissions)) {
    if (!seedIds.has(officeId)) throw new Error(`Office permissions name an unknown office definition: ${officeId}.`);
    for (const permission of permissions) {
      if (!TREASURY_PERMISSIONS.includes(permission)) throw new Error(`Office ${officeId} has an unknown permission.`);
    }
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
