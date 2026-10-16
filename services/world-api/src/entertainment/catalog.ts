/**
 * Stage 17 — Entertainment and Media System
 * Loads and provides access to the entertainment catalogue.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { EntertainmentCatalog, EntertainmentRules, ProductionStatusId, ContentStatusId } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CATALOG_FILE = "game/data/entertainment/catalog.json";

function repositoryRoot(): string {
  return join(__dirname, "../../../..");
}

let cached: EntertainmentCatalog | null = null;

export function loadEntertainmentCatalog(): EntertainmentCatalog {
  if (cached) return cached;
  const catalogPath = join(repositoryRoot(), CATALOG_FILE);
  const raw = readFileSync(catalogPath, "utf-8");
  const parsed = JSON.parse(raw) as EntertainmentCatalog;
  cached = parsed;
  return parsed;
}

export class EntertainmentCatalogService {
  private catalog: EntertainmentCatalog;

  constructor() {
    this.catalog = loadEntertainmentCatalog();
  }

  get(): EntertainmentCatalog { return this.catalog; }
  getRules(): EntertainmentRules { return this.catalog.rules; }

  hasProfession(id: string): boolean { return this.catalog.professions.some((p) => p.id === id); }
  hasSkill(id: string): boolean { return this.catalog.skills.some((s) => s.id === id); }
  hasContentType(id: string): boolean { return this.catalog.content_types.some((c) => c.id === id); }
  hasGenre(id: string): boolean { return this.catalog.genres.some((g) => g.id === id); }
  hasReleaseType(id: string): boolean { return this.catalog.release_types.some((r) => r.id === id); }
  hasEventType(id: string): boolean { return this.catalog.event_types.some((e) => e.id === id); }
  hasContractType(id: string): boolean { return this.catalog.contract_types.some((c) => c.id === id); }
  hasProfessionCategory(id: string): boolean { return this.catalog.profession_categories.some((c) => c.id === id); }
  hasNewsTopic(id: string): boolean { return this.catalog.news_topics.some((t) => t.id === id); }

  getProfession(id: string) { return this.catalog.professions.find((p) => p.id === id); }
  getProfessionsByCategory(category: string) { return this.catalog.professions.filter((p) => p.category === category); }
  getSkill(id: string) { return this.catalog.skills.find((s) => s.id === id); }

  isValidProjectTransition(from: ProductionStatusId, to: ProductionStatusId): boolean {
    return (this.catalog.project_status_transitions[from] ?? []).includes(to);
  }

  isValidContentTransition(from: ContentStatusId, to: ContentStatusId): boolean {
    return (this.catalog.content_status_transitions[from] ?? []).includes(to);
  }

  getCareerStage(fameScore: number): string {
    const stages = [...this.catalog.career_stages].sort((a, b) => b.min_fame - a.min_fame);
    for (const stage of stages) {
      if (fameScore >= stage.min_fame) return stage.id;
    }
    return "beginner";
  }
}
