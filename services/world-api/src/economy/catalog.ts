import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EconomyCatalog } from "./types.js";

const CATALOG_FILE = "game/data/economy/catalog.json";
const VALID_CATEGORIES = new Set([
  "food", "health", "transport", "utilities", "clothing", "entertainment", "housing", "education", "other",
]);
const VALID_GOOD_LOCATION_IDS = new Set([
  "town", "home", "schoolyard", "classroom", "campus", "training_center", "market", "clinic",
  "police_station", "community_hall",
]);
const BANK_PRODUCT_KINDS = new Set(["savings", "current", "fixed_deposit"]);
const LOAN_PRODUCT_KINDS = new Set(["personal", "student", "business"]);

function repositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(candidate, CATALOG_FILE))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not locate ${CATALOG_FILE}; the economy catalog is required.`);
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

function validateCatalog(value: unknown): EconomyCatalog {
  if (!isRecord(value) || value.schema_version !== 1 || value.world_id !== "nigeria-main" ||
    typeof value.notice !== "string" || value.notice.length < 30 || !isRecord(value.rules) ||
    !Array.isArray(value.tax_bands) || !Array.isArray(value.bank_products) ||
    !Array.isArray(value.loan_products) || !Array.isArray(value.market_goods)) {
    throw new Error("Economy catalog is incomplete or has an unsupported schema/world.");
  }
  const catalog = value as unknown as EconomyCatalog;
  uniqueIds(catalog.tax_bands, "Economy tax bands");
  uniqueIds(catalog.bank_products, "Economy bank products");
  uniqueIds(catalog.loan_products, "Economy loan products");
  uniqueIds(catalog.market_goods, "Economy market goods");

  const rules = catalog.rules;
  if (rules.currency !== "NGN" || typeof rules.currency_label !== "string" || typeof rules.currency_symbol !== "string" ||
    !Number.isSafeInteger(rules.maximum_account_balance_ngn) || rules.maximum_account_balance_ngn < 1 || rules.maximum_account_balance_ngn > 10_000_000_000 ||
    !Number.isSafeInteger(rules.minimum_account_balance_ngn) || rules.minimum_account_balance_ngn < 0 ||
    rules.minimum_account_balance_ngn >= rules.maximum_account_balance_ngn ||
    !Number.isSafeInteger(rules.maximum_transaction_amount_ngn) || rules.maximum_transaction_amount_ngn < 1 ||
    rules.maximum_transaction_amount_ngn > rules.maximum_account_balance_ngn ||
    !Number.isSafeInteger(rules.minimum_transaction_amount_ngn) || rules.minimum_transaction_amount_ngn < 1 ||
    rules.minimum_transaction_amount_ngn > rules.maximum_transaction_amount_ngn ||
    !Number.isSafeInteger(rules.maximum_transfer_amount_ngn) || rules.maximum_transfer_amount_ngn < 1 ||
    rules.maximum_transfer_amount_ngn > rules.maximum_transaction_amount_ngn ||
    !Number.isSafeInteger(rules.maximum_loan_amount_ngn) || rules.maximum_loan_amount_ngn < 1 ||
    rules.maximum_loan_amount_ngn > rules.maximum_account_balance_ngn ||
    !Number.isSafeInteger(rules.maximum_transaction_history_per_account) || rules.maximum_transaction_history_per_account < 10 ||
    rules.maximum_transaction_history_per_account > 10_000 ||
    !Number.isSafeInteger(rules.maximum_accounts_per_character) || rules.maximum_accounts_per_character < 1 ||
    rules.maximum_accounts_per_character > 10 ||
    !Number.isSafeInteger(rules.minimum_credit_score) || rules.minimum_credit_score < 0 || rules.minimum_credit_score > 1000 ||
    !Number.isSafeInteger(rules.maximum_credit_score) || rules.maximum_credit_score < rules.minimum_credit_score || rules.maximum_credit_score > 1000 ||
    !Number.isSafeInteger(rules.starting_credit_score) || rules.starting_credit_score < rules.minimum_credit_score || rules.starting_credit_score > rules.maximum_credit_score ||
    !Number.isSafeInteger(rules.minimum_credit_score_for_loan) || rules.minimum_credit_score_for_loan < rules.minimum_credit_score ||
    rules.minimum_credit_score_for_loan > rules.maximum_credit_score ||
    !Number.isSafeInteger(rules.transaction_idempotency_window_seconds) || rules.transaction_idempotency_window_seconds < 1 ||
    rules.transaction_idempotency_window_seconds > 604_800) {
    throw new Error("Economy rules contain invalid bounds.");
  }

  for (const band of catalog.tax_bands) {
    if (!Number.isSafeInteger(band.minimum_monthly_income_ngn) || band.minimum_monthly_income_ngn < 0 ||
      !Number.isSafeInteger(band.maximum_monthly_income_ngn) || band.maximum_monthly_income_ngn <= band.minimum_monthly_income_ngn ||
      !Number.isSafeInteger(band.rate_percent) || band.rate_percent < 0 || band.rate_percent > 100) {
      throw new Error(`Economy tax band ${band.id} has invalid bounds.`);
    }
  }
  const sortedBands = [...catalog.tax_bands].sort((a, b) => a.minimum_monthly_income_ngn - b.minimum_monthly_income_ngn);
  for (let index = 1; index < sortedBands.length; index += 1) {
    const previous = sortedBands[index - 1]!;
    const current = sortedBands[index]!;
    if (current.minimum_monthly_income_ngn !== previous.maximum_monthly_income_ngn + 1) {
      throw new Error("Economy tax bands must be contiguous and non-overlapping.");
    }
  }

  for (const product of catalog.bank_products) {
    if (!BANK_PRODUCT_KINDS.has(product.kind) || !product.label ||
      typeof product.interest_rate_monthly_percent !== "number" || product.interest_rate_monthly_percent < 0 || product.interest_rate_monthly_percent > 100 ||
      !Number.isSafeInteger(product.minimum_balance_ngn) || product.minimum_balance_ngn < 0 ||
      !Number.isSafeInteger(product.monthly_fee_ngn) || product.monthly_fee_ngn < 0 ||
      !Number.isSafeInteger(product.withdrawal_fee_ngn) || product.withdrawal_fee_ngn < 0 ||
      !Number.isSafeInteger(product.transfer_fee_ngn) || product.transfer_fee_ngn < 0 ||
      !Number.isSafeInteger(product.max_withdrawal_daily_ngn) || product.max_withdrawal_daily_ngn < 1) {
      throw new Error(`Economy bank product ${product.id} has invalid configuration.`);
    }
  }

  for (const product of catalog.loan_products) {
    if (!LOAN_PRODUCT_KINDS.has(product.kind) || !product.label ||
      typeof product.interest_rate_monthly_percent !== "number" || product.interest_rate_monthly_percent < 0 || product.interest_rate_monthly_percent > 100 ||
      !Number.isSafeInteger(product.maximum_amount_ngn) || product.maximum_amount_ngn < 1 || product.maximum_amount_ngn > rules.maximum_loan_amount_ngn ||
      !Number.isSafeInteger(product.maximum_term_months) || product.maximum_term_months < 1 || product.maximum_term_months > 360 ||
      !Number.isSafeInteger(product.minimum_credit_score) || product.minimum_credit_score < rules.minimum_credit_score ||
      product.minimum_credit_score > rules.maximum_credit_score ||
      typeof product.origination_fee_percent !== "number" || product.origination_fee_percent < 0 || product.origination_fee_percent > 50 ||
      !Number.isSafeInteger(product.late_payment_fee_ngn) || product.late_payment_fee_ngn < 0 ||
      typeof product.requires_employment !== "boolean") {
      throw new Error(`Economy loan product ${product.id} has invalid configuration.`);
    }
  }

  for (const good of catalog.market_goods) {
    if (!good.category || !good.label || !good.unit ||
      !VALID_CATEGORIES.has(good.category) ||
      !Number.isSafeInteger(good.base_price_ngn) || good.base_price_ngn < 1 || good.base_price_ngn > rules.maximum_transaction_amount_ngn ||
      !Number.isSafeInteger(good.hunger_restore) || good.hunger_restore < 0 || good.hunger_restore > 100 ||
      !Array.isArray(good.location_ids) || good.location_ids.length === 0 ||
      good.location_ids.some((locationId) => !VALID_GOOD_LOCATION_IDS.has(locationId))) {
      throw new Error(`Economy market good ${good.id} has invalid configuration.`);
    }
  }

  return catalog;
}

let cachedCatalog: EconomyCatalog | null = null;

export function loadEconomyCatalog(): EconomyCatalog {
  if (cachedCatalog !== null) return cachedCatalog;
  const configuredDirectory = process.env.NAIJA_ECONOMY_DATA_DIR;
  const filePath = configuredDirectory ? resolve(configuredDirectory, "catalog.json") : join(repositoryRoot(), CATALOG_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Could not load economy catalog at ${filePath}.`, { cause: error });
  }
  cachedCatalog = validateCatalog(parsed);
  return cachedCatalog;
}

export function validateEconomyCatalogForTest(value: unknown): EconomyCatalog {
  return validateCatalog(value);
}
