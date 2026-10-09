/**
 * Stage 11 — Elections and Politics System
 *
 * Loads and validates the static elections catalogue.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectionsCatalog } from "./types.js";

const CATALOG_FILE = "game/data/elections/catalog.json";

function repositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(candidate, CATALOG_FILE))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not locate ${CATALOG_FILE}; the elections catalogue is required.`);
}

let cached: ElectionsCatalog | null = null;

export function loadElectionsCatalog(): ElectionsCatalog {
  if (cached) return cached;
  const catalogPath = join(repositoryRoot(), CATALOG_FILE);
  const raw = readFileSync(catalogPath, "utf-8");
  const parsed = JSON.parse(raw) as ElectionsCatalog;
  validateCatalog(parsed);
  cached = parsed;
  return parsed;
}

function validateCatalog(catalog: ElectionsCatalog): void {
  if (catalog.schema_version !== 1) throw new Error("elections_catalog_schema_mismatch");
  if (catalog.world_id !== "nigeria-main") throw new Error("elections_catalog_world_mismatch");
  if (!Array.isArray(catalog.election_types) || catalog.election_types.length === 0) throw new Error("elections_catalog_no_types");
  if (!Array.isArray(catalog.election_phases) || catalog.election_phases.length === 0) throw new Error("elections_catalog_no_phases");
  if (typeof catalog.eligibility_rules !== "object" || catalog.eligibility_rules === null) throw new Error("elections_catalog_no_eligibility_rules");
  if (typeof catalog.voter_eligibility !== "object" || catalog.voter_eligibility === null) throw new Error("elections_catalog_no_voter_eligibility");
  if (typeof catalog.party_rules !== "object" || catalog.party_rules === null) throw new Error("elections_catalog_no_party_rules");
  if (typeof catalog.campaign_rules !== "object" || catalog.campaign_rules === null) throw new Error("elections_catalog_no_campaign_rules");
}

export function getElectionType(catalog: ElectionsCatalog, typeId: string) {
  return catalog.election_types.find((t) => t.id === typeId) ?? null;
}

export function getEligibilityRules(catalog: ElectionsCatalog, electionType: string) {
  return catalog.eligibility_rules[electionType] ?? null;
}
