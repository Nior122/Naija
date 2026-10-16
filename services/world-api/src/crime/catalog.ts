/**
 * Stage 15 — Crime and Consequences System
 * Loads and provides access to the crime catalogue.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CrimeCatalog, CrimeDefinition, CrimeCategoryDefinition, CrimeSeverityDefinition, CrimeRules, ConsequenceRules, CrimeIncidentStatusId, CrimeCategoryId } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CATALOG_FILE = "game/data/crime/catalog.json";

function repositoryRoot(): string {
  return join(__dirname, "../../../..");
}

let cached: CrimeCatalog | null = null;

export function loadCrimeCatalog(): CrimeCatalog {
  if (cached) return cached;
  const catalogPath = join(repositoryRoot(), CATALOG_FILE);
  const raw = readFileSync(catalogPath, "utf-8");
  const parsed = JSON.parse(raw) as CrimeCatalog;
  cached = parsed;
  return parsed;
}

export class CrimeCatalogService {
  private catalog: CrimeCatalog;

  constructor() {
    this.catalog = loadCrimeCatalog();
  }

  get(): CrimeCatalog {
    return this.catalog;
  }

  getRules(): CrimeRules {
    return this.catalog.rules;
  }

  getConsequenceRules(): ConsequenceRules {
    return this.catalog.consequence_rules;
  }

  getCrimeDefinition(id: string): CrimeDefinition | undefined {
    return this.catalog.crime_definitions.find((d) => d.id === id);
  }

  getCategory(id: string): CrimeCategoryDefinition | undefined {
    return this.catalog.crime_categories.find((c) => c.id === id);
  }

  getSeverity(id: string): CrimeSeverityDefinition | undefined {
    return this.catalog.crime_severities.find((s) => s.id === id);
  }

  getDefinitionsByCategory(category: CrimeCategoryId): readonly CrimeDefinition[] {
    return this.catalog.crime_definitions.filter((d) => d.category === category);
  }

  getValidTransitions(status: CrimeIncidentStatusId): readonly CrimeIncidentStatusId[] {
    return this.catalog.valid_transitions[status] ?? [];
  }

  isValidTransition(from: CrimeIncidentStatusId, to: CrimeIncidentStatusId): boolean {
    return this.getValidTransitions(from).includes(to);
  }

  hasCategory(id: string): boolean {
    return this.catalog.crime_categories.some((c) => c.id === id);
  }

  hasSeverity(id: string): boolean {
    return this.catalog.crime_severities.some((s) => s.id === id);
  }

  getReputationImpact(severity: string): number {
    const rules = this.catalog.rules;
    switch (severity) {
      case "minor": return rules.reputation_impact_minor;
      case "moderate": return rules.reputation_impact_moderate;
      case "serious": return rules.reputation_impact_serious;
      case "severe": return rules.reputation_impact_severe;
      default: return 0;
    }
  }

  isCategoryEligibleForBackgroundCheck(category: CrimeCategoryId): boolean {
    return this.catalog.consequence_rules.employment_background_check_categories.includes(category);
  }

  isCategoryEligibleForPoliticalDisqualification(category: CrimeCategoryId): boolean {
    return this.catalog.consequence_rules.political_disqualification_categories.includes(category);
  }
}
