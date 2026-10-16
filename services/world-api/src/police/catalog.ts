/**
 * Stage 13 — Police and Security System
 *
 * Loads and validates the police catalogue from game/data/police/catalog.json.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PoliceCatalog,
  RankDefinition,
  IncidentCategoryDefinition,
  DispatchPriorityDefinition,
  MisconductCategoryDefinition,
  TrainingModuleDefinition,
  ComplaintOutcomeDefinition,
  PoliceRules,
  PoliceLevelDefinition,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CATALOG_FILE = "game/data/police/catalog.json";

function repositoryRoot(): string {
  return join(__dirname, "../../../..");
}

let cached: PoliceCatalog | null = null;

export function loadPoliceCatalog(): PoliceCatalog {
  if (cached) return cached;
  const catalogPath = join(repositoryRoot(), CATALOG_FILE);
  const raw = readFileSync(catalogPath, "utf-8");
  const parsed = JSON.parse(raw) as PoliceCatalog;
  cached = parsed;
  return parsed;
}

export class PoliceCatalogService {
  private catalog: PoliceCatalog;

  constructor() {
    this.catalog = loadPoliceCatalog();
  }

  get(): PoliceCatalog {
    return this.catalog;
  }

  getRules(): PoliceRules {
    return this.get().rules;
  }

  getRank(id: string): RankDefinition | undefined {
    return this.get().ranks.find((r) => r.id === id);
  }

  getIncidentCategory(id: string): IncidentCategoryDefinition | undefined {
    return this.get().incident_categories.find((c) => c.id === id);
  }

  getDispatchPriority(id: string): DispatchPriorityDefinition | undefined {
    return this.get().dispatch_priorities.find((p) => p.id === id);
  }

  getMisconductCategory(id: string): MisconductCategoryDefinition | undefined {
    return this.get().misconduct_categories.find((c) => c.id === id);
  }

  getTrainingModule(id: string): TrainingModuleDefinition | undefined {
    return this.get().training_modules.find((m) => m.id === id);
  }

  getComplaintOutcome(id: string): ComplaintOutcomeDefinition | undefined {
    return this.get().complaint_outcomes.find((o) => o.id === id);
  }

  getPoliceLevel(id: string): PoliceLevelDefinition | undefined {
    return this.get().police_levels.find((l) => l.id === id);
  }

  hasRank(id: string): boolean {
    return this.get().ranks.some((r) => r.id === id);
  }

  hasIncidentCategory(id: string): boolean {
    return this.get().incident_categories.some((c) => c.id === id);
  }

  hasDispatchPriority(id: string): boolean {
    return this.get().dispatch_priorities.some((p) => p.id === id);
  }

  hasMisconductCategory(id: string): boolean {
    return this.get().misconduct_categories.some((c) => c.id === id);
  }

  hasComplaintOutcome(id: string): boolean {
    return this.get().complaint_outcomes.some((o) => o.id === id);
  }

  getMinimumRecruitmentAge(): number {
    return this.getRules().minimum_recruitment_age;
  }

  getMinimumEducation(): string {
    return this.getRules().minimum_education_for_recruitment;
  }

  getTrainingDurationDays(): number {
    return this.getRules().training_duration_days;
  }
}


