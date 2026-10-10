/**
 * Stage 14 — Military System
 *
 * Loads and validates the military catalogue from game/data/military/catalog.json.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  MilitaryCatalog,
  ServiceBranchDefinition,
  RankDefinition,
  BaseCategoryDefinition,
  UnitCategoryDefinition,
  TrainingCourseDefinition,
  AssignmentTypeDefinition,
  EquipmentCategoryDefinition,
  NationalSecurityEventCategoryDefinition,
  DisciplinaryOutcomeDefinition,
  MilitaryRules,
  ServiceBranchId,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CATALOG_FILE = "game/data/military/catalog.json";

function repositoryRoot(): string {
  return join(__dirname, "../../../..");
}

let cached: MilitaryCatalog | null = null;

export function loadMilitaryCatalog(): MilitaryCatalog {
  if (cached) return cached;
  const catalogPath = join(repositoryRoot(), CATALOG_FILE);
  const raw = readFileSync(catalogPath, "utf-8");
  const parsed = JSON.parse(raw) as MilitaryCatalog;
  cached = parsed;
  return parsed;
}

export class MilitaryCatalogService {
  private catalog: MilitaryCatalog;

  constructor() {
    this.catalog = loadMilitaryCatalog();
  }

  get(): MilitaryCatalog {
    return this.catalog;
  }

  getRules(): MilitaryRules {
    return this.catalog.rules;
  }

  getBranch(id: string): ServiceBranchDefinition | undefined {
    return this.catalog.service_branches.find((b) => b.id === id);
  }

  getRanks(branch: ServiceBranchId): readonly RankDefinition[] {
    return this.catalog.rank_categories[branch] ?? [];
  }

  getRank(branch: ServiceBranchId, rankId: string): RankDefinition | undefined {
    return this.getRanks(branch).find((r) => r.id === rankId);
  }

  getAllRanks(): readonly RankDefinition[] {
    const all: RankDefinition[] = [];
    for (const branch of Object.values(this.catalog.rank_categories)) {
      all.push(...branch);
    }
    return all;
  }

  getBaseCategory(id: string): BaseCategoryDefinition | undefined {
    return this.catalog.base_categories.find((c) => c.id === id);
  }

  getUnitCategory(id: string): UnitCategoryDefinition | undefined {
    return this.catalog.unit_categories.find((c) => c.id === id);
  }

  getTrainingCourse(id: string): TrainingCourseDefinition | undefined {
    return this.catalog.training_courses.find((c) => c.id === id);
  }

  getTrainingCoursesForBranch(branch: ServiceBranchId): readonly TrainingCourseDefinition[] {
    return this.catalog.training_courses.filter((c) => c.branch === "all" || c.branch === branch);
  }

  getAssignmentType(id: string): AssignmentTypeDefinition | undefined {
    return this.catalog.assignment_types.find((t) => t.id === id);
  }

  getEquipmentCategory(id: string): EquipmentCategoryDefinition | undefined {
    return this.catalog.equipment_categories.find((c) => c.id === id);
  }

  getNationalSecurityEventCategory(id: string): NationalSecurityEventCategoryDefinition | undefined {
    return this.catalog.national_security_event_categories.find((c) => c.id === id);
  }

  getDisciplinaryOutcome(id: string): DisciplinaryOutcomeDefinition | undefined {
    return this.catalog.disciplinary_outcomes.find((o) => o.id === id);
  }

  hasBranch(id: string): boolean {
    return this.catalog.service_branches.some((b) => b.id === id);
  }

  hasRank(branch: ServiceBranchId, rankId: string): boolean {
    return this.getRanks(branch).some((r) => r.id === rankId);
  }

  hasBaseCategory(id: string): boolean {
    return this.catalog.base_categories.some((c) => c.id === id);
  }

  hasUnitCategory(id: string): boolean {
    return this.catalog.unit_categories.some((c) => c.id === id);
  }

  hasAssignmentType(id: string): boolean {
    return this.catalog.assignment_types.some((t) => t.id === id);
  }

  hasEquipmentCategory(id: string): boolean {
    return this.catalog.equipment_categories.some((c) => c.id === id);
  }

  hasNationalSecurityEventCategory(id: string): boolean {
    return this.catalog.national_security_event_categories.some((c) => c.id === id);
  }

  hasDisciplinaryOutcome(id: string): boolean {
    return this.catalog.disciplinary_outcomes.some((o) => o.id === id);
  }

  getMinimumRecruitmentAge(): number {
    return this.catalog.rules.minimum_recruitment_age;
  }

  getMinimumEducation(): string {
    return this.catalog.rules.minimum_education_for_recruitment;
  }

  getMinimumTimeInRankDays(category: string): number {
    return this.catalog.rules.minimum_time_in_rank_days[category] ?? 365;
  }
}
