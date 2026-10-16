/**
 * Stage 16 — Religion, Culture and Community System
 * Loads and provides access to the culture catalogue.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CultureCatalog, CultureRules, CommunityTypeDefinition, InstitutionCategoryDefinition, FestivalDefinition, ProjectStatusId } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CATALOG_FILE = "game/data/culture/catalog.json";

function repositoryRoot(): string {
  return join(__dirname, "../../../..");
}

let cached: CultureCatalog | null = null;

export function loadCultureCatalog(): CultureCatalog {
  if (cached) return cached;
  const catalogPath = join(repositoryRoot(), CATALOG_FILE);
  const raw = readFileSync(catalogPath, "utf-8");
  const parsed = JSON.parse(raw) as CultureCatalog;
  cached = parsed;
  return parsed;
}

export class CultureCatalogService {
  private catalog: CultureCatalog;

  constructor() {
    this.catalog = loadCultureCatalog();
  }

  get(): CultureCatalog { return this.catalog; }
  getRules(): CultureRules { return this.catalog.rules; }

  getCommunityType(id: string): CommunityTypeDefinition | undefined {
    return this.catalog.community_types.find((c) => c.id === id);
  }

  getInstitutionCategory(id: string): InstitutionCategoryDefinition | undefined {
    return this.catalog.institution_categories.find((c) => c.id === id);
  }

  getFestivalDefinition(id: string): FestivalDefinition | undefined {
    return this.catalog.festival_definitions.find((f) => f.id === id);
  }

  getLanguage(id: string) {
    return this.catalog.languages.find((l) => l.id === id);
  }

  getValidProjectTransitions(status: ProjectStatusId): readonly ProjectStatusId[] {
    return this.catalog.project_status_transitions[status] ?? [];
  }

  isValidProjectTransition(from: ProjectStatusId, to: ProjectStatusId): boolean {
    return this.getValidProjectTransitions(from).includes(to);
  }

  hasCommunityType(id: string): boolean {
    return this.catalog.community_types.some((c) => c.id === id);
  }

  hasInstitutionCategory(id: string): boolean {
    return this.catalog.institution_categories.some((c) => c.id === id);
  }

  hasLanguage(id: string): boolean {
    return this.catalog.languages.some((l) => l.id === id);
  }

  hasReligiousCategory(id: string): boolean {
    return this.catalog.religious_categories.some((r) => r.id === id);
  }

  hasProjectCategory(id: string): boolean {
    return this.catalog.project_categories.some((p) => p.id === id);
  }

  hasFestivalCategory(id: string): boolean {
    return this.catalog.festival_categories.some((f) => f.id === id);
  }
}
