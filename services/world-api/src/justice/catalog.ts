/**
 * Stage 12 — Laws, Courts and Justice System
 *
 * Loads and validates the static justice catalogue.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JusticeCatalog } from "./types.js";

const CATALOG_FILE = "game/data/justice/catalog.json";

function repositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(candidate, CATALOG_FILE))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not locate ${CATALOG_FILE}; the justice catalogue is required.`);
}

let cached: JusticeCatalog | null = null;

export function loadJusticeCatalog(): JusticeCatalog {
  if (cached) return cached;
  const catalogPath = join(repositoryRoot(), CATALOG_FILE);
  const raw = readFileSync(catalogPath, "utf-8");
  const parsed = JSON.parse(raw) as JusticeCatalog;
  validateCatalog(parsed);
  cached = parsed;
  return parsed;
}

function validateCatalog(catalog: JusticeCatalog): void {
  if (catalog.schema_version !== 1) throw new Error("justice_catalog_schema_mismatch");
  if (catalog.world_id !== "nigeria-main") throw new Error("justice_catalog_world_mismatch");
  if (!Array.isArray(catalog.law_categories) || catalog.law_categories.length === 0) throw new Error("justice_catalog_no_law_categories");
  if (!Array.isArray(catalog.court_levels) || catalog.court_levels.length === 0) throw new Error("justice_catalog_no_court_levels");
  if (!Array.isArray(catalog.case_categories) || catalog.case_categories.length === 0) throw new Error("justice_catalog_no_case_categories");
  if (typeof catalog.rules !== "object" || catalog.rules === null) throw new Error("justice_catalog_no_rules");
  if (!Array.isArray(catalog.seed_laws)) throw new Error("justice_catalog_no_seed_laws");
  if (!Array.isArray(catalog.seed_courts)) throw new Error("justice_catalog_no_seed_courts");
}

export function getLawCategory(catalog: JusticeCatalog, categoryId: string) {
  return catalog.law_categories.find((c) => c.id === categoryId) ?? null;
}

export function getCaseCategory(catalog: JusticeCatalog, categoryId: string) {
  return catalog.case_categories.find((c) => c.id === categoryId) ?? null;
}

export function getCourtLevel(catalog: JusticeCatalog, levelId: string) {
  return catalog.court_levels.find((l) => l.id === levelId) ?? null;
}
