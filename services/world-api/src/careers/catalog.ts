import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEducationCatalog } from "../education/catalog.js";
import type { CareerCatalog } from "./types.js";

const CATALOG_FILE = "game/data/careers/careers_catalog.json";
const WEEKDAYS = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
const LOCATIONS = new Set([
  "town", "home", "schoolyard", "classroom", "campus", "training_center", "market", "clinic",
  "police_station", "community_hall",
]);
const EDUCATION_LEVELS = new Set(["none", "secondary", "vocational", "tertiary"]);
const EMPLOYMENT_TYPES = new Set([
  "full_time", "part_time", "shift", "contract", "temporary", "seasonal", "casual", "apprenticeship", "freelance", "self_employed",
]);
const PAY_FREQUENCIES = new Set(["weekly", "biweekly", "monthly"]);

function repositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(candidate, CATALOG_FILE))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not locate ${CATALOG_FILE}; the careers catalog is required.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 120);
}

function uniqueIds(values: readonly { readonly id: string }[], label: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (!value.id || value.id.length > 120 || ids.has(value.id)) throw new Error(`${label} has a missing or duplicate ID.`);
    ids.add(value.id);
  }
}

function validateCatalog(value: unknown): CareerCatalog {
  if (!isRecord(value) || value.schema_version !== 1 || value.world_id !== "nigeria-main" ||
    typeof value.notice !== "string" || value.notice.length < 30 || !isRecord(value.rules) ||
    !Array.isArray(value.industries) || !Array.isArray(value.skills) || !Array.isArray(value.work_schedules) ||
    !Array.isArray(value.jobs) || !Array.isArray(value.employers) || !Array.isArray(value.vacancies)) {
    throw new Error("Careers catalog is incomplete or has an unsupported schema/world.");
  }
  const catalog = value as unknown as CareerCatalog;
  uniqueIds(catalog.industries, "Career industries");
  uniqueIds(catalog.skills, "Career skills");
  uniqueIds(catalog.work_schedules, "Career work schedules");
  uniqueIds(catalog.jobs, "Career jobs");
  uniqueIds(catalog.employers, "Career employers");
  uniqueIds(catalog.vacancies, "Career vacancies");

  const expectedCodes = "ABCDEFGHIJKL";
  if (catalog.industries.length !== expectedCodes.length ||
    [...expectedCodes].some((code) => !catalog.industries.some((industry) => industry.code === code)) ||
    catalog.industries.some((industry) => !industry.label || !/^[a-z0-9-]+$/.test(industry.id))) {
    throw new Error("Career industries must configure the distinct A–L prototype categories.");
  }
  const industryIds = new Set(catalog.industries.map((industry) => industry.id));
  const careerSkills = new Set(catalog.skills.map((skill) => skill.id));
  const education = loadEducationCatalog();
  const knownSkills = new Set([...careerSkills, ...education.skills.map((skill) => skill.id)]);
  const scheduleIds = new Set(catalog.work_schedules.map((schedule) => schedule.id));
  const jobIds = new Set(catalog.jobs.map((job) => job.id));
  const employerIds = new Set(catalog.employers.map((employer) => employer.id));
  const locations = new Set<string>(LOCATIONS);

  if (catalog.skills.some((skill) => !skill.name || !skill.category) ||
    catalog.work_schedules.some((schedule) => !schedule.label || schedule.working_weekdays.length === 0 ||
      schedule.working_weekdays.some((weekday) => !WEEKDAYS.has(weekday)) ||
      !Number.isSafeInteger(schedule.start_minute) || !Number.isSafeInteger(schedule.end_minute) ||
      schedule.start_minute < 0 || schedule.end_minute > 1440 || schedule.start_minute >= schedule.end_minute ||
      !Number.isSafeInteger(schedule.scheduled_work_minutes) || schedule.scheduled_work_minutes < 1 ||
      schedule.scheduled_work_minutes > schedule.end_minute - schedule.start_minute ||
      !Number.isSafeInteger(schedule.minimum_session_minutes) || schedule.minimum_session_minutes < 1 ||
      schedule.minimum_session_minutes > schedule.scheduled_work_minutes ||
      !Number.isSafeInteger(schedule.clock_in_grace_minutes) || schedule.clock_in_grace_minutes < 0 || schedule.clock_in_grace_minutes > 180 ||
      !Number.isSafeInteger(schedule.weekly_hours) || schedule.weekly_hours < 1 || schedule.weekly_hours > 60)) {
    throw new Error("Career skills or work schedules contain invalid entries.");
  }

  for (const job of catalog.jobs) {
    const salaryRange = job.salary_range_monthly_ngn;
    if (!industryIds.has(job.industry_id) || !job.track_id || !job.title || !job.description || !job.duties ||
      !Number.isSafeInteger(job.career_level) || job.career_level < 1 || job.career_level > 10 ||
      !Number.isSafeInteger(job.minimum_age) || job.minimum_age < catalog.rules.minimum_working_age || job.minimum_age > 100 ||
      !Number.isSafeInteger(job.maximum_weekly_hours) || job.maximum_weekly_hours < 1 || job.maximum_weekly_hours > 60 ||
      !EDUCATION_LEVELS.has(job.minimum_education) || !scheduleIds.has(job.schedule_id) ||
      !Array.isArray(job.employment_types) || job.employment_types.length === 0 ||
      job.employment_types.some((type) => !EMPLOYMENT_TYPES.has(type)) ||
      !job.employment_types.includes(job.default_employment_type) ||
      !Number.isSafeInteger(salaryRange.minimum) || !Number.isSafeInteger(salaryRange.maximum) ||
      salaryRange.minimum < 0 || salaryRange.maximum < salaryRange.minimum || salaryRange.maximum > catalog.rules.maximum_salary_monthly_ngn ||
      !knownSkills.has(job.work_skill_id) || !Number.isSafeInteger(job.work_skill_experience_per_session) ||
      job.work_skill_experience_per_session < 0 || job.work_skill_experience_per_session > 1000 ||
      !Number.isSafeInteger(job.minimum_experience_sessions) || job.minimum_experience_sessions < 0 ||
      !stringArray(job.required_qualifications) || !Array.isArray(job.required_qualification_groups) ||
      job.required_qualification_groups.some((group) => !stringArray(group)) ||
      !stringArray(job.required_licenses) || !stringArray(job.career_links) ||
      !Array.isArray(job.required_skills) || job.required_skills.some((skill) =>
        !knownSkills.has(skill.skill_id) || !Number.isSafeInteger(skill.minimum_level) || skill.minimum_level < 1 || skill.minimum_level > 100) ||
      typeof job.regulated !== "boolean" || typeof job.future_stage_only !== "boolean" ||
      (job.regulated && (job.required_licenses.length === 0 || job.minimum_age < 18)) ||
      (job.minimum_age < 18 && (job.maximum_weekly_hours > 12 || job.regulated || job.employment_types.some((type) =>
        !["part_time", "casual", "temporary"].includes(type))))) {
      throw new Error(`Career job ${job.id} has invalid age, hours, eligibility, schedule, salary, or qualification rules.`);
    }
    const schedule = catalog.work_schedules.find((entry) => entry.id === job.schedule_id)!;
    if (job.maximum_weekly_hours > schedule.weekly_hours && !job.employment_types.includes("self_employed")) {
      throw new Error(`Career job ${job.id} exceeds its configured schedule hours.`);
    }
    if (job.promotion_to !== null) {
      const nextJob = jobIds.has(job.promotion_to)
        ? catalog.jobs.find((entry) => entry.id === job.promotion_to)
        : undefined;
      if (!nextJob || nextJob.track_id !== job.track_id || nextJob.career_level <= job.career_level ||
        nextJob.industry_id !== job.industry_id || !Number.isSafeInteger(job.minimum_sessions_to_promote) ||
        job.minimum_sessions_to_promote < 1 || job.minimum_performance_to_promote < 0 || job.minimum_performance_to_promote > 100) {
        throw new Error(`Career job ${job.id} has an invalid promotion path.`);
      }
    }
    if (job.future_stage_only && job.npc_assignable) throw new Error(`Future-stage career ${job.id} cannot be an NPC fixture occupation.`);
  }

  for (const employer of catalog.employers) {
    if (!industryIds.has(employer.industry_id) || !locations.has(employer.location_id) ||
      !employer.name || !employer.kind || !employer.description || employer.prototype_fixture !== true ||
      !Number.isSafeInteger(employer.capacity) || employer.capacity < 0 || typeof employer.active !== "boolean" ||
      (employer.linked_institution_id !== undefined && employer.linked_institution_id !== null &&
        !education.institutions.some((institution) => institution.id === employer.linked_institution_id))) {
      throw new Error(`Career employer ${employer.id} has an invalid location, institution, capacity, or fixture declaration.`);
    }
  }
  for (const vacancy of catalog.vacancies) {
    const job = catalog.jobs.find((entry) => entry.id === vacancy.job_id);
    const hasEmployer = vacancy.employer_id === null || employerIds.has(vacancy.employer_id);
    if (!job || job.future_stage_only || !hasEmployer ||
      !Number.isSafeInteger(vacancy.monthly_salary_ngn) || vacancy.monthly_salary_ngn < 0 ||
      vacancy.monthly_salary_ngn > catalog.rules.maximum_salary_monthly_ngn ||
      vacancy.monthly_salary_ngn < job.salary_range_monthly_ngn.minimum ||
      vacancy.monthly_salary_ngn > job.salary_range_monthly_ngn.maximum ||
      !job.employment_types.includes(vacancy.employment_type) || !PAY_FREQUENCIES.has(vacancy.pay_frequency) ||
      !Number.isSafeInteger(vacancy.openings) || vacancy.openings < 1 || vacancy.openings > 1000 ||
      !["open", "closed"].includes(vacancy.status)) {
      throw new Error(`Career vacancy ${vacancy.id} refers to invalid job/employer/pay data.`);
    }
  }

  const rules = catalog.rules;
  if (!Number.isSafeInteger(rules.application_review_days) || rules.application_review_days < 1 || rules.application_review_days > 30 ||
    !Number.isSafeInteger(rules.minimum_working_age) || rules.minimum_working_age < 16 || rules.minimum_working_age > 21 ||
    !Number.isSafeInteger(rules.maximum_search_results) || rules.maximum_search_results < 1 || rules.maximum_search_results > 200 ||
    !Number.isSafeInteger(rules.maximum_applications_per_character) || rules.maximum_applications_per_character < 1 || rules.maximum_applications_per_character > 1000 ||
    !Number.isSafeInteger(rules.maximum_sessions_per_employment) || rules.maximum_sessions_per_employment < 1 || rules.maximum_sessions_per_employment > 10000 ||
    !Number.isSafeInteger(rules.maximum_history_records_per_character) || rules.maximum_history_records_per_character < 10 || rules.maximum_history_records_per_character > 5000 ||
    !Number.isSafeInteger(rules.maximum_leave_days) || rules.maximum_leave_days < 1 || rules.maximum_leave_days > 60 ||
    !Number.isSafeInteger(rules.maximum_salary_monthly_ngn) || rules.maximum_salary_monthly_ngn < 1 || rules.maximum_salary_monthly_ngn > 100_000_000 ||
    !Number.isSafeInteger(rules.minimum_payable_balance_ngn) || !Number.isSafeInteger(rules.maximum_payable_balance_ngn) ||
    rules.minimum_payable_balance_ngn < 0 || rules.maximum_payable_balance_ngn <= rules.minimum_payable_balance_ngn ||
    !Number.isSafeInteger(rules.review_after_completed_sessions) || rules.review_after_completed_sessions < 1 || rules.review_after_completed_sessions > 100 ||
    !Number.isSafeInteger(rules.performance_history_window) || rules.performance_history_window < 1 || rules.performance_history_window > 100 ||
    !stringArray(rules.npc_occupation_job_ids) || rules.npc_occupation_job_ids.some((id) => {
      const job = catalog.jobs.find((entry) => entry.id === id);
      return !job || !job.npc_assignable || job.future_stage_only;
    })) {
    throw new Error("Career rules contain invalid bounds or NPC occupation references.");
  }
  return catalog;
}

let cachedCatalog: CareerCatalog | null = null;

export function loadCareerCatalog(): CareerCatalog {
  if (cachedCatalog !== null) return cachedCatalog;
  const configuredDirectory = process.env.NAIJA_CAREERS_DATA_DIR;
  const filePath = configuredDirectory ? resolve(configuredDirectory, "careers_catalog.json") : join(repositoryRoot(), CATALOG_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Could not load careers catalog at ${filePath}.`, { cause: error });
  }
  cachedCatalog = validateCatalog(parsed);
  return cachedCatalog;
}

export function validateCareerCatalogForTest(value: unknown): CareerCatalog {
  return validateCatalog(value);
}
