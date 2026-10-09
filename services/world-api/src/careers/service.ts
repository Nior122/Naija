import { createHash, randomUUID } from "node:crypto";
import {
  addDays,
  ageOnDate,
  compareDates,
  daysInMonth,
  isValidDate,
  weekdayForDate,
} from "../life/calendar.js";
import { loadLifeCatalog } from "../life/calendar.js";
import type { CalendarDate } from "../life/types.js";
import type { CharacterRecord, PersistentPlayer, PersistentWorldState } from "../multiplayer/types.js";
import { loadCareerCatalog } from "./catalog.js";
import type {
  CareerApplicationRecord,
  CareerCatalog,
  CareerEmploymentRecord,
  CareerEmploymentSnapshot,
  CareerEmploymentStatus,
  CareerEventRecord,
  CareerJobDefinition,
  CareerJobSearchEntry,
  CareerLeaveRequestRecord,
  CareerLicenseRecord,
  CareerPerformanceReviewRecord,
  CareerProfileSnapshot,
  CareerSkillRecord,
  CareerVacancyRecord,
  CareerWorkSessionRecord,
  CareerPayFrequency,
  SalaryPaymentRecord,
} from "./types.js";

const ACTIVE_EMPLOYMENT_STATUSES = new Set<CareerEmploymentStatus>(["active", "on_leave", "suspended"]);
const PENDING_APPLICATION_STATUSES = new Set(["draft", "submitted", "under_review", "interview_requested"]);
const CAREER_KEY_SEPARATOR = "::career::";

export interface SalaryAccountPort {
  balanceForCharacter(characterId: string): number | null;
  /** Must atomically credit the existing account and de-duplicate `paymentId`. */
  creditSalary(characterId: string, amountNgn: number, paymentId: string, postedAt: string): void;
}

export interface ApplicationDecision {
  readonly character_id: string;
  readonly application_id: string;
  readonly status: "accepted" | "rejected";
  readonly message: string;
}

function cloneDate(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: date.day };
}

function dateKey(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function nextPaymentDate(date: CalendarDate, frequency: CareerPayFrequency): CalendarDate {
  if (frequency === "weekly") return addDays(date, 7);
  if (frequency === "biweekly") return addDays(date, 14);
  const month = date.month === 12 ? 1 : date.month + 1;
  const year = date.month === 12 ? date.year + 1 : date.year;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

function characterForId(state: PersistentWorldState, characterId: string): PersistentPlayer | undefined {
  return Object.values(state.players).find((player) => player.character.character_id === characterId);
}

function allEducationQualifications(character: CharacterRecord): readonly Record<string, unknown>[] {
  const value: unknown = character.education_record?.qualifications;
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> =>
    typeof entry === "object" && entry !== null && !Array.isArray(entry)) : [];
}

function educationQualificationIds(character: CharacterRecord): Set<string> {
  return new Set(allEducationQualifications(character).flatMap((entry) =>
    typeof entry.id === "string" ? [entry.id] : []));
}

function careerSkillKey(characterId: string, skillId: string): string {
  return createHash("sha256").update(`${characterId}${CAREER_KEY_SEPARATOR}${skillId}`).digest("hex");
}

function licenseKey(characterId: string, licenseId: string): string {
  return createHash("sha256").update(`${characterId}${CAREER_KEY_SEPARATOR}${licenseId}`).digest("hex");
}

function careerSkillLevel(
  state: PersistentWorldState,
  character: CharacterRecord,
  skillId: string,
): number {
  const fromEducation = character.education_record?.skills?.find((skill) => skill.skill_id === skillId)?.level ?? 0;
  const fromCareer = state.careerSkills[careerSkillKey(character.character_id, skillId)]?.level ?? 0;
  return Math.max(fromEducation, fromCareer);
}

function activeEmploymentFor(state: PersistentWorldState, characterId: string): CareerEmploymentRecord | undefined {
  return Object.values(state.employments).find((employment) =>
    employment.character_id === characterId && ACTIVE_EMPLOYMENT_STATUSES.has(employment.status));
}

function activeLeaveOnDate(
  state: PersistentWorldState,
  employmentId: string,
  date: CalendarDate,
): CareerLeaveRequestRecord | undefined {
  return Object.values(state.careerLeaveRequests).find((request) =>
    request.employment_id === employmentId && request.status === "approved" &&
    compareDates(request.start_date, date) <= 0 && compareDates(request.end_date, date) >= 0);
}

function educationLevelSatisfied(character: CharacterRecord, level: CareerJobDefinition["minimum_education"]): boolean {
  if (level === "none") return true;
  const qualificationIds = educationQualificationIds(character);
  const allIds = [...qualificationIds];
  const hasTertiary = allIds.some((id) => id.startsWith("qualification:imu-") ||
    id.startsWith("qualification:itp-") || id.startsWith("qualification:ice-") || id.startsWith("qualification:prototype-"));
  const hasVocational = allIds.some((id) => id.startsWith("qualification:trade-"));
  if (level === "secondary") return qualificationIds.has("qualification:secondary-school-certificate") || hasTertiary;
  if (level === "vocational") return hasVocational || hasTertiary;
  return hasTertiary;
}

function hasQualificationGroup(character: CharacterRecord, group: readonly string[]): boolean {
  const qualifications = allEducationQualifications(character);
  const ids = new Set(qualifications.flatMap((entry) => typeof entry.id === "string" ? [entry.id] : []));
  return group.some((id) => ids.has(id));
}

function countCompletedSessions(state: PersistentWorldState, characterId: string): number {
  return Object.values(state.workSessions).filter((session) =>
    session.character_id === characterId && session.status === "completed").length;
}

function averagePerformance(state: PersistentWorldState, characterId: string, limit: number): number {
  const scores = Object.values(state.workSessions)
    .filter((session) => session.character_id === characterId && session.status === "completed")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, limit)
    .map((session) => session.performance_score);
  return scores.length === 0 ? 0 : Math.round(scores.reduce((total, score) => total + score, 0) / scores.length);
}

function averageEmploymentPerformance(state: PersistentWorldState, employmentId: string, limit: number): number {
  const scores = Object.values(state.workSessions)
    .filter((session) => session.employment_id === employmentId && session.status === "completed")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, limit)
    .map((session) => session.performance_score);
  return scores.length === 0 ? 0 : Math.round(scores.reduce((total, score) => total + score, 0) / scores.length);
}

export function careerEligibility(
  state: PersistentWorldState,
  character: CharacterRecord,
  job: CareerJobDefinition,
  date: CalendarDate = state.worldClock.world_date,
  options: { readonly checkVacancy?: CareerVacancyRecord; readonly checkCurrentEmployment?: boolean } = {},
): { readonly eligible: boolean; readonly missing: readonly string[]; readonly score: number } {
  const catalog = loadCareerCatalog();
  const missing: string[] = [];
  const derivedAge = ageOnDate(character.date_of_birth, date);
  if (character.life_status === "deceased") missing.push("Deceased characters cannot apply for or hold work.");
  if (character.life_status === "retired" && !job.allow_retired) missing.push("This role does not accept retired characters.");
  if (derivedAge < Math.max(catalog.rules.minimum_working_age, job.minimum_age)) {
    missing.push(`Minimum age: ${Math.max(catalog.rules.minimum_working_age, job.minimum_age)} years.`);
  }
  if (job.future_stage_only) missing.push("This occupation is a later-stage catalogue placeholder and is not open for recruitment.");
  if (!educationLevelSatisfied(character, job.minimum_education)) {
    missing.push(`Requires ${job.minimum_education} education recorded in the Stage 4 qualification history.`);
  }
  const qualificationIds = educationQualificationIds(character);
  for (const requiredId of job.required_qualifications) {
    if (!qualificationIds.has(requiredId)) missing.push(`Missing qualification: ${requiredId}.`);
  }
  for (const group of job.required_qualification_groups) {
    if (!hasQualificationGroup(character, group)) missing.push(`Requires one of: ${group.join(" or ")}.`);
  }
  for (const licenseId of job.required_licenses) {
    const license = state.careerLicenses[licenseKey(character.character_id, licenseId)];
    if (!license || license.status !== "active") missing.push(`Required prototype professional registration: ${licenseId}.`);
  }
  for (const skill of job.required_skills) {
    const currentLevel = careerSkillLevel(state, character, skill.skill_id);
    if (currentLevel < skill.minimum_level) {
      missing.push(`Skill ${skill.skill_id} level ${skill.minimum_level} required; current level ${currentLevel}.`);
    }
  }
  if (countCompletedSessions(state, character.character_id) < job.minimum_experience_sessions) {
    missing.push(`Requires ${job.minimum_experience_sessions} completed work sessions across career history.`);
  }
  if (job.minimum_experience_sessions > 0 && averagePerformance(state, character.character_id, catalog.rules.performance_history_window) < 60) {
    missing.push("Requires a satisfactory recorded work-performance history.");
  }
  if (options.checkCurrentEmployment !== false && activeEmploymentFor(state, character.character_id)) {
    missing.push("Resign or complete the current employment before taking another full work commitment.");
  }
  if (options.checkVacancy) {
    const vacancy = options.checkVacancy;
    const employer = vacancy.employer_id ? state.careerEmployers[vacancy.employer_id] : undefined;
    if (vacancy.status !== "open" || vacancy.openings_remaining <= 0) missing.push("No position is currently open in this vacancy.");
    if (vacancy.employer_id && (!employer || !employer.active)) missing.push("The configured employer is not currently hiring.");
    if (employer && employer.employee_character_ids.length >= employer.capacity &&
      !employer.employee_character_ids.includes(character.character_id)) {
      missing.push("The configured employer has reached its prototype staffing capacity.");
    }
    if (vacancy.monthly_salary_ngn < job.salary_range_monthly_ngn.minimum ||
      vacancy.monthly_salary_ngn > job.salary_range_monthly_ngn.maximum) missing.push("The configured pay offer is outside the role's catalogue range.");
  }
  const skillPoints = job.required_skills.reduce((total, required) =>
    total + Math.min(careerSkillLevel(state, character, required.skill_id), required.minimum_level) * 2, 0);
  const careerLinkBonus = allEducationQualifications(character).some((qualification) => {
    const links: unknown = qualification.career_links;
    return Array.isArray(links) && links.some((link) => typeof link === "string" && job.career_links.includes(link));
  }) ? 8 : 0;
  const experienceBonus = Math.min(20, countCompletedSessions(state, character.character_id));
  const performanceBonus = Math.round(averagePerformance(state, character.character_id, catalog.rules.performance_history_window) / 10);
  const score = Math.min(100, 50 + skillPoints + careerLinkBonus + experienceBonus + performanceBonus);
  return { eligible: missing.length === 0, missing, score };
}

function appendCareerEvent(
  state: PersistentWorldState,
  characterId: string,
  type: string,
  summary: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  details: Record<string, string | number | boolean | null> = {},
  employmentId?: string,
  applicationId?: string,
): CareerEventRecord {
  const eventId = `career-event-${randomUUID()}`;
  const event: CareerEventRecord = {
    event_id: eventId,
    character_id: characterId,
    type,
    world_date: cloneDate(date),
    minute_of_day: Math.max(0, Math.min(1439, Math.floor(minuteOfDay))),
    summary,
    details,
    created_at: new Date(now).toISOString(),
    ...(employmentId ? { employment_id: employmentId } : {}),
    ...(applicationId ? { application_id: applicationId } : {}),
  };
  state.careerEvents[eventId] = event;
  const maximum = loadCareerCatalog().rules.maximum_history_records_per_character;
  const ownEvents = Object.values(state.careerEvents)
    .filter((entry) => entry.character_id === characterId)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  for (const expired of ownEvents.slice(0, Math.max(0, ownEvents.length - maximum))) delete state.careerEvents[expired.event_id];
  return event;
}

function employerNameFor(state: PersistentWorldState, employerId: string | null): string {
  if (!employerId) return "Self-employed / independent work";
  return state.careerEmployers[employerId]?.name ?? loadCareerCatalog().employers.find((employer) => employer.id === employerId)?.name ?? "Prototype employer";
}

function createEmployment(
  state: PersistentWorldState,
  application: CareerApplicationRecord,
  vacancy: CareerVacancyRecord,
  date: CalendarDate,
  now: number,
  catalog: CareerCatalog,
): CareerEmploymentRecord {
  const job = catalog.jobs.find((entry) => entry.id === vacancy.job_id);
  if (!job) throw new Error("career_job_not_found");
  const employmentId = `employment-${randomUUID()}`;
  const employment: CareerEmploymentRecord = {
    employment_id: employmentId,
    character_id: application.character_id,
    application_id: application.application_id,
    vacancy_id: vacancy.vacancy_id,
    employer_id: vacancy.employer_id,
    employer_name_at_start: employerNameFor(state, vacancy.employer_id),
    job_id: job.id,
    employment_type: vacancy.employment_type,
    status: "active",
    salary_ngn_monthly: vacancy.monthly_salary_ngn,
    pay_frequency: vacancy.pay_frequency,
    work_schedule_id: job.schedule_id,
    start_date: cloneDate(date),
    pay_period_start_date: cloneDate(date),
    next_payment_date: nextPaymentDate(date, vacancy.pay_frequency),
    completed_sessions: 0,
    performance_score: 0,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  state.employments[employmentId] = employment;
  application.status = "accepted";
  application.employment_id = employmentId;
  application.updated_at = employment.updated_at;
  application.decision_reason = "Eligibility and an available prototype vacancy were verified by the server.";
  vacancy.openings_remaining = Math.max(0, vacancy.openings_remaining - 1);
  vacancy.status = vacancy.openings_remaining > 0 ? "open" : "filled";
  vacancy.updated_at = employment.updated_at;
  if (vacancy.employer_id) {
    const employer = state.careerEmployers[vacancy.employer_id];
    if (employer && !employer.employee_character_ids.includes(application.character_id)) {
      employer.employee_character_ids.push(application.character_id);
      employer.updated_at = employment.updated_at;
    }
  }
  appendCareerEvent(state, application.character_id, "employment_started", `Started ${job.title}.`, date,
    state.worldClock.minute_of_day, now, { job_id: job.id, employer_id: vacancy.employer_id, monthly_salary_ngn: vacancy.monthly_salary_ngn }, employmentId, application.application_id);
  return employment;
}

export function searchCareerJobs(
  state: PersistentWorldState,
  character: CharacterRecord,
  query: { readonly text?: string; readonly industry_id?: string; readonly location_id?: string } = {},
  catalog: CareerCatalog = loadCareerCatalog(),
): CareerJobSearchEntry[] {
  const text = (query.text ?? "").trim().toLocaleLowerCase("en-NG");
  if (text.length > 80) throw new Error("career_query_invalid");
  const rows: CareerJobSearchEntry[] = [];
  for (const vacancy of Object.values(state.careerVacancies)) {
    if (vacancy.status !== "open" || vacancy.openings_remaining <= 0) continue;
    const job = catalog.jobs.find((entry) => entry.id === vacancy.job_id);
    if (!job || job.future_stage_only) continue;
    const employer = vacancy.employer_id ? state.careerEmployers[vacancy.employer_id] : undefined;
    const employerName = employerNameFor(state, vacancy.employer_id);
    const industry = catalog.industries.find((entry) => entry.id === job.industry_id);
    const location = employer?.location_id ?? "home";
    if (query.industry_id && query.industry_id !== job.industry_id) continue;
    if (query.location_id && query.location_id !== location) continue;
    if (text && !`${job.title} ${job.description} ${employerName} ${industry?.label ?? ""}`.toLocaleLowerCase("en-NG").includes(text)) continue;
    const latestApplication = Object.values(state.careerApplications)
      .filter((application) => application.character_id === character.character_id && application.vacancy_id === vacancy.vacancy_id)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
    const eligibility = careerEligibility(state, character, job, state.worldClock.world_date, { checkVacancy: vacancy });
    const schedule = catalog.work_schedules.find((entry) => entry.id === job.schedule_id);
    if (!industry || !schedule) continue;
    rows.push({
      vacancy_id: vacancy.vacancy_id,
      job_id: job.id,
      title: job.title,
      industry_id: industry.id,
      industry_label: industry.label,
      career_level: job.career_level,
      description: job.description,
      duties: job.duties,
      employer_id: vacancy.employer_id,
      employer_name: employerName,
      employer_description: employer?.description ?? "Individual work only; no employer or business entity is created.",
      prototype_fixture: employer?.prototype_fixture ?? true,
      employer_employee_count: employer?.employee_character_ids.length ?? 0,
      work_location_id: location,
      salary_range_monthly_ngn: { ...job.salary_range_monthly_ngn },
      monthly_salary_offer_ngn: vacancy.monthly_salary_ngn,
      pay_frequency: vacancy.pay_frequency,
      employment_type: vacancy.employment_type,
      schedule: { ...schedule, working_weekdays: [...schedule.working_weekdays] },
      minimum_age: job.minimum_age,
      minimum_education: job.minimum_education,
      required_qualifications: [...job.required_qualifications],
      required_qualification_groups: job.required_qualification_groups.map((group) => [...group]),
      required_licenses: [...job.required_licenses],
      required_skills: job.required_skills.map((skill) => ({ ...skill })),
      eligible: eligibility.eligible,
      missing_requirements: [...eligibility.missing],
      openings_remaining: vacancy.openings_remaining,
      application_status: latestApplication?.status ?? null,
    });
  }
  return rows.sort((left, right) =>
    Number(right.eligible) - Number(left.eligible) || left.title.localeCompare(right.title) || left.vacancy_id.localeCompare(right.vacancy_id))
    .slice(0, catalog.rules.maximum_search_results);
}

export function submitCareerApplication(
  state: PersistentWorldState,
  characterId: string,
  vacancyId: string,
  date: CalendarDate = state.worldClock.world_date,
  now: number = Date.now(),
  catalog: CareerCatalog = loadCareerCatalog(),
): CareerApplicationRecord {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("career_character_not_found");
  const vacancy = state.careerVacancies[vacancyId];
  if (!vacancy) throw new Error("career_vacancy_not_found");
  const previous = Object.values(state.careerApplications)
    .filter((application) => application.character_id === characterId && application.vacancy_id === vacancyId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  if (previous && PENDING_APPLICATION_STATUSES.has(previous.status)) return previous;
  if (Object.values(state.careerApplications).filter((application) => application.character_id === characterId).length >= catalog.rules.maximum_applications_per_character) {
    throw new Error("career_application_limit_reached");
  }
  const job = catalog.jobs.find((entry) => entry.id === vacancy.job_id);
  if (!job) throw new Error("career_job_not_found");
  const eligibility = careerEligibility(state, player.character, job, date, { checkVacancy: vacancy });
  if (!eligibility.eligible) throw new Error("career_application_ineligible");
  const nowIso = new Date(now).toISOString();
  const application: CareerApplicationRecord = {
    application_id: `application-${randomUUID()}`,
    character_id: characterId,
    vacancy_id: vacancy.vacancy_id,
    job_id: job.id,
    employer_id: vacancy.employer_id,
    status: "under_review",
    created_at: nowIso,
    submitted_world_date: cloneDate(date),
    review_due_date: addDays(date, catalog.rules.application_review_days),
    eligibility_score: eligibility.score,
    updated_at: nowIso,
    decision_reason: `The server will review this application on ${dateKey(addDays(date, catalog.rules.application_review_days))}.`,
  };
  state.careerApplications[application.application_id] = application;
  appendCareerEvent(state, characterId, "application_submitted", `Applied for ${job.title}; server review is pending.`, date,
    state.worldClock.minute_of_day, now, { vacancy_id: vacancy.vacancy_id, eligibility_score: eligibility.score }, undefined, application.application_id);
  return application;
}

function rejectApplication(
  state: PersistentWorldState,
  application: CareerApplicationRecord,
  date: CalendarDate,
  now: number,
  reason: string,
): ApplicationDecision {
  application.status = "rejected";
  application.decision_reason = reason;
  application.updated_at = new Date(now).toISOString();
  appendCareerEvent(state, application.character_id, "application_rejected", "The application was not selected for this vacancy.", date,
    state.worldClock.minute_of_day, now, { reason }, undefined, application.application_id);
  return { character_id: application.character_id, application_id: application.application_id, status: "rejected", message: reason };
}

export function processPendingCareerApplications(
  state: PersistentWorldState,
  date: CalendarDate,
  now: number = Date.now(),
  catalog: CareerCatalog = loadCareerCatalog(),
): ApplicationDecision[] {
  const pending = Object.values(state.careerApplications)
    .filter((application) => PENDING_APPLICATION_STATUSES.has(application.status) && compareDates(application.review_due_date, date) <= 0)
    .sort((left, right) => compareDates(left.review_due_date, right.review_due_date) ||
      right.eligibility_score - left.eligibility_score ||
      compareDates(left.submitted_world_date, right.submitted_world_date) ||
      left.application_id.localeCompare(right.application_id));
  const decisions: ApplicationDecision[] = [];
  for (const application of pending) {
    const player = characterForId(state, application.character_id);
    const job = catalog.jobs.find((entry) => entry.id === application.job_id);
    const vacancy = state.careerVacancies[application.vacancy_id];
    if (!player || !job) {
      decisions.push(rejectApplication(state, application, date, now, "The character or job record is no longer available."));
      continue;
    }
    if (!vacancy || vacancy.status !== "open" || vacancy.openings_remaining <= 0) {
      decisions.push(rejectApplication(state, application, date, now, "The vacancy was filled before this application was reviewed."));
      continue;
    }
    const eligibility = careerEligibility(state, player.character, job, date, { checkVacancy: vacancy });
    if (!eligibility.eligible) {
      decisions.push(rejectApplication(state, application, date, now, eligibility.missing.join(" ") || "Eligibility changed before review."));
      continue;
    }
    const employment = createEmployment(state, application, vacancy, date, now, catalog);
    appendCareerEvent(state, application.character_id, "application_accepted", `The application for ${job.title} was accepted.`, date,
      state.worldClock.minute_of_day, now, { vacancy_id: vacancy.vacancy_id, job_id: job.id }, employment.employment_id, application.application_id);
    decisions.push({ character_id: application.character_id, application_id: application.application_id, status: "accepted", message: "The application was accepted and employment was recorded." });
  }
  return decisions;
}

export function withdrawCareerApplication(
  state: PersistentWorldState,
  characterId: string,
  applicationId: string,
  date: CalendarDate = state.worldClock.world_date,
  now: number = Date.now(),
): CareerApplicationRecord {
  const application = state.careerApplications[applicationId];
  if (!application || application.character_id !== characterId) throw new Error("career_application_not_found");
  if (!PENDING_APPLICATION_STATUSES.has(application.status)) throw new Error("career_application_not_withdrawable");
  application.status = "withdrawn";
  application.decision_reason = "Withdrawn by the applicant before a decision.";
  application.updated_at = new Date(now).toISOString();
  appendCareerEvent(state, characterId, "application_withdrawn", "Withdrew the application before a decision.", date,
    state.worldClock.minute_of_day, now, { vacancy_id: application.vacancy_id }, undefined, application.application_id);
  return application;
}

export function prototypeSalaryAccountPort(state: PersistentWorldState, catalog: CareerCatalog = loadCareerCatalog()): SalaryAccountPort {
  return {
    balanceForCharacter(characterId: string): number | null {
      return characterForId(state, characterId)?.character.money ?? null;
    },
    creditSalary(characterId: string, amountNgn: number, paymentId: string, postedAt: string): void {
      if (!Number.isSafeInteger(amountNgn) || amountNgn <= 0 || !paymentId) throw new Error("career_salary_amount_invalid");
      if (state.salaryPayments[paymentId]) return;
      const player = characterForId(state, characterId);
      if (!player || player.character.life_status === "deceased") throw new Error("career_salary_account_unavailable");
      const balance = player.character.money;
      if (!Number.isSafeInteger(balance) || balance < catalog.rules.minimum_payable_balance_ngn ||
        balance + amountNgn > catalog.rules.maximum_payable_balance_ngn) throw new Error("career_salary_balance_limit");
      player.character.money = balance + amountNgn;
      player.character.updated_at = postedAt;
    },
  };
}

function postSalaryPayment(
  state: PersistentWorldState,
  employment: CareerEmploymentRecord,
  sessions: CareerWorkSessionRecord[],
  date: CalendarDate,
  finalPayment: boolean,
  now: number,
  account: SalaryAccountPort,
): SalaryPaymentRecord | null | false {
  const validSessions = sessions.filter((session) => session.status === "completed" && session.gross_earned_ngn > 0 && !session.payroll_payment_id);
  const amount = validSessions.reduce((sum, session) => sum + session.gross_earned_ngn, 0);
  if (validSessions.length === 0 || amount <= 0) return null;
  const existingStart = employment.pay_period_start_date;
  const periodEnd = finalPayment ? date : addDays(employment.next_payment_date, -1);
  const paymentId = finalPayment
    ? `payroll:${employment.employment_id}:final:${dateKey(date)}`
    : `payroll:${employment.employment_id}:${dateKey(existingStart)}:${dateKey(periodEnd)}`;
  const existing = state.salaryPayments[paymentId];
  if (existing) {
    for (const session of validSessions) session.payroll_payment_id = paymentId;
    return existing;
  }
  try {
    if (account.balanceForCharacter(employment.character_id) === null) return false;
  } catch {
    return false;
  }
  const postedAt = new Date(now).toISOString();
  const payment: SalaryPaymentRecord = {
    payment_id: paymentId,
    employment_id: employment.employment_id,
    character_id: employment.character_id,
    employer_id: employment.employer_id,
    amount_ngn: amount,
    pay_frequency: employment.pay_frequency,
    pay_period_start_date: cloneDate(existingStart),
    pay_period_end_date: cloneDate(periodEnd),
    paid_at_world_date: cloneDate(date),
    final_payment: finalPayment,
    work_session_ids: validSessions.map((session) => session.session_id),
    posted_at: postedAt,
  };
  // The recipient account, payment ID and session settlement are committed in one JSON snapshot.
  // Stage 7 can replace this adapter with the canonical Naira ledger using payment_id as its idempotency key.
  try {
    account.creditSalary(employment.character_id, amount, paymentId, postedAt);
  } catch {
    return false;
  }
  state.salaryPayments[paymentId] = payment;
  for (const session of validSessions) session.payroll_payment_id = paymentId;
  appendCareerEvent(state, employment.character_id, "salary_paid", `Salary of ₦${amount.toLocaleString("en-NG")} was posted.`, date,
    state.worldClock.minute_of_day, now, { amount_ngn: amount, payment_id: paymentId, final_payment: finalPayment }, employment.employment_id);
  return payment;
}

function settledSessionsForEmployment(
  state: PersistentWorldState,
  employment: CareerEmploymentRecord,
  start: CalendarDate,
  endExclusive: CalendarDate | null,
): CareerWorkSessionRecord[] {
  return Object.values(state.workSessions).filter((session) =>
    session.employment_id === employment.employment_id && session.status === "completed" &&
    !session.payroll_payment_id && compareDates(session.world_date, start) >= 0 &&
    (!endExclusive || compareDates(session.world_date, endExclusive) < 0));
}

function postDuePayroll(
  state: PersistentWorldState,
  employment: CareerEmploymentRecord,
  throughDate: CalendarDate,
  now: number,
  account: SalaryAccountPort,
): number {
  let posted = 0;
  for (let cycle = 0; cycle < 52 && compareDates(employment.next_payment_date, throughDate) <= 0; cycle += 1) {
    const dueDate = cloneDate(employment.next_payment_date);
    const sessions = settledSessionsForEmployment(state, employment, employment.pay_period_start_date, dueDate);
    const payment = postSalaryPayment(state, employment, sessions, dueDate, false, now, account);
    if (payment === false) break;
    if (payment) posted += 1;
    employment.pay_period_start_date = dueDate;
    employment.next_payment_date = nextPaymentDate(dueDate, employment.pay_frequency);
    employment.updated_at = new Date(now).toISOString();
  }
  return posted;
}

function postFinalPayroll(
  state: PersistentWorldState,
  employment: CareerEmploymentRecord,
  date: CalendarDate,
  now: number,
  account: SalaryAccountPort,
): number | false {
  const sessions = settledSessionsForEmployment(state, employment, employment.pay_period_start_date, null);
  const payment = postSalaryPayment(state, employment, sessions, date, true, now, account);
  return payment === false ? false : payment ? 1 : 0;
}

function closeEmployment(
  state: PersistentWorldState,
  employment: CareerEmploymentRecord,
  status: CareerEmploymentStatus,
  reason: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  account: SalaryAccountPort,
  settleEarnedWork: boolean,
): CareerEmploymentRecord {
  if (!ACTIVE_EMPLOYMENT_STATUSES.has(employment.status)) return employment;
  if (settleEarnedWork && postFinalPayroll(state, employment, date, now, account) === false) {
    throw new Error("career_salary_payment_deferred");
  }
  if (employment.current_work_session_id) {
    const session = state.workSessions[employment.current_work_session_id];
    if (session?.status === "in_progress") {
      session.status = "invalidated";
      session.invalidation_reason = reason;
      session.updated_at = new Date(now).toISOString();
    }
    delete employment.current_work_session_id;
  }
  employment.status = status;
  employment.end_date = cloneDate(date);
  employment.end_reason = reason.slice(0, 200);
  employment.updated_at = new Date(now).toISOString();
  const employer = employment.employer_id ? state.careerEmployers[employment.employer_id] : undefined;
  if (employer) {
    employer.employee_character_ids = employer.employee_character_ids.filter((id) => id !== employment.character_id);
    employer.updated_at = employment.updated_at;
  }
  const vacancy = state.careerVacancies[employment.vacancy_id];
  if (vacancy && vacancy.status !== "closed") {
    vacancy.openings_remaining = Math.min(vacancy.openings_total, vacancy.openings_remaining + 1);
    vacancy.status = "open";
    vacancy.updated_at = employment.updated_at;
  }
  appendCareerEvent(state, employment.character_id, `employment_${status}`, reason, date, minuteOfDay, now,
    { job_id: employment.job_id, status, settled_earned_work: settleEarnedWork }, employment.employment_id);
  return employment;
}

export function resignCareerEmployment(
  state: PersistentWorldState,
  characterId: string,
  employmentId: string,
  date: CalendarDate = state.worldClock.world_date,
  minuteOfDay: number = state.worldClock.minute_of_day,
  now: number = Date.now(),
  account: SalaryAccountPort = prototypeSalaryAccountPort(state),
): CareerEmploymentRecord {
  const employment = state.employments[employmentId];
  if (!employment || employment.character_id !== characterId) throw new Error("career_employment_not_found");
  if (!ACTIVE_EMPLOYMENT_STATUSES.has(employment.status)) return employment;
  return closeEmployment(state, employment, "resigned", "Resigned voluntarily; completed eligible sessions were settled.",
    date, minuteOfDay, now, account, true);
}

export function terminateCareerEmploymentAsEmployer(
  state: PersistentWorldState,
  actor: { readonly kind: "employer"; readonly employer_id: string },
  employmentId: string,
  reason: string,
  date: CalendarDate = state.worldClock.world_date,
  minuteOfDay: number = state.worldClock.minute_of_day,
  now: number = Date.now(),
  account: SalaryAccountPort = prototypeSalaryAccountPort(state),
): CareerEmploymentRecord {
  const employment = state.employments[employmentId];
  if (!employment || !employment.employer_id || actor.kind !== "employer" || actor.employer_id !== employment.employer_id ||
    !state.careerEmployers[actor.employer_id]?.active) throw new Error("career_employer_unauthorized");
  const cleanReason = reason.trim().replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 160);
  if (!cleanReason) throw new Error("career_termination_reason_required");
  return closeEmployment(state, employment, "terminated", cleanReason, date, minuteOfDay, now, account, true);
}

export function retireCareerEmployments(
  state: PersistentWorldState,
  characterId: string,
  date: CalendarDate = state.worldClock.world_date,
  minuteOfDay: number = state.worldClock.minute_of_day,
  now: number = Date.now(),
  account: SalaryAccountPort = prototypeSalaryAccountPort(state),
): number {
  const player = characterForId(state, characterId);
  const person = player?.character ?? state.people[characterId];
  if (!person || person.life_status !== "retired") throw new Error("retirement_age_ineligible");
  let ended = 0;
  for (const employment of Object.values(state.employments)) {
    if (employment.character_id !== characterId || !ACTIVE_EMPLOYMENT_STATUSES.has(employment.status)) continue;
    const job = loadCareerCatalog().jobs.find((entry) => entry.id === employment.job_id);
    if (job?.allow_retired) continue;
    closeEmployment(state, employment, "retired", "Retired under the shared life-simulation retirement rule.",
      date, minuteOfDay, now, account, true);
    ended += 1;
  }
  const npc = state.npcCareers[characterId];
  if (npc) {
    npc.status = "retired";
    npc.updated_at = new Date(now).toISOString();
  }
  return ended;
}

export function endCareerAtDeath(
  state: PersistentWorldState,
  characterId: string,
  date: CalendarDate = state.worldClock.world_date,
  minuteOfDay: number = state.worldClock.minute_of_day,
  now: number = Date.now(),
): number {
  let ended = 0;
  for (const employment of Object.values(state.employments)) {
    if (employment.character_id !== characterId || !ACTIVE_EMPLOYMENT_STATUSES.has(employment.status)) continue;
    closeEmployment(state, employment, "deceased", "Employment ended when the life record became deceased; no future wages are paid.",
      date, minuteOfDay, now, prototypeSalaryAccountPort(state), false);
    ended += 1;
  }
  const npc = state.npcCareers[characterId];
  if (npc) {
    npc.status = "deceased";
    npc.updated_at = new Date(now).toISOString();
  }
  return ended;
}

function findCurrentEmployment(state: PersistentWorldState, characterId: string): CareerEmploymentRecord {
  const employment = activeEmploymentFor(state, characterId);
  if (!employment) throw new Error("career_employment_inactive");
  return employment;
}

function personCanWork(character: CharacterRecord, job: CareerJobDefinition, date: CalendarDate): void {
  if (character.life_status === "deceased") throw new Error("character_deceased");
  if (character.life_status === "retired" && !job.allow_retired) throw new Error("career_retired_character");
  if (ageOnDate(character.date_of_birth, date) < job.minimum_age) throw new Error("career_age_ineligible");
}

function workLocation(state: PersistentWorldState, employment: CareerEmploymentRecord): string {
  return employment.employer_id ? state.careerEmployers[employment.employer_id]?.location_id ?? "" : "home";
}

function employmentProfile(
  state: PersistentWorldState,
  employment: CareerEmploymentRecord,
  character: CharacterRecord,
  catalog: CareerCatalog,
): CareerEmploymentSnapshot {
  const job = catalog.jobs.find((entry) => entry.id === employment.job_id);
  const schedule = catalog.work_schedules.find((entry) => entry.id === employment.work_schedule_id);
  const nextJob = job?.promotion_to ? catalog.jobs.find((entry) => entry.id === job.promotion_to) : undefined;
  const promotionVacancy = nextJob ? Object.values(state.careerVacancies).find((vacancy) =>
    vacancy.job_id === nextJob.id && vacancy.employer_id === employment.employer_id &&
    vacancy.status === "open" && vacancy.openings_remaining > 0) : undefined;
  let promotionAvailable = false;
  if (job && nextJob && promotionVacancy && employment.status === "active" && !employment.current_work_session_id &&
    !activeLeaveOnDate(state, employment.employment_id, state.worldClock.world_date) &&
    employment.completed_sessions >= job.minimum_sessions_to_promote &&
    employment.performance_score >= job.minimum_performance_to_promote) {
    promotionAvailable = careerEligibility(state, character, nextJob, state.worldClock.world_date, {
      checkVacancy: promotionVacancy,
      checkCurrentEmployment: false,
    }).eligible;
  }
  return {
    ...employment,
    job_title: job?.title ?? employment.job_id,
    work_location_id: workLocation(state, employment),
    schedule: schedule ? { ...schedule, working_weekdays: [...schedule.working_weekdays] } : null,
    promotion_available: promotionAvailable,
    promotion_job_title: promotionAvailable ? nextJob?.title ?? null : null,
  };
}

function sessionIdFor(employmentId: string, date: CalendarDate): string {
  return `work-session:${employmentId}:${dateKey(date)}`;
}

export function startCareerWorkSession(
  state: PersistentWorldState,
  characterId: string,
  date: CalendarDate = state.worldClock.world_date,
  minuteOfDay: number = state.worldClock.minute_of_day,
  currentLocation?: string,
  now: number = Date.now(),
  catalog: CareerCatalog = loadCareerCatalog(),
): CareerWorkSessionRecord {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("career_character_not_found");
  const employment = findCurrentEmployment(state, characterId);
  const job = catalog.jobs.find((entry) => entry.id === employment.job_id);
  const schedule = catalog.work_schedules.find((entry) => entry.id === employment.work_schedule_id);
  if (!job || !schedule) throw new Error("career_schedule_not_found");
  personCanWork(player.character, job, date);
  if (employment.status === "suspended") throw new Error("career_employment_suspended");
  if (activeLeaveOnDate(state, employment.employment_id, date)) throw new Error("career_leave_active");
  if (activeEmploymentFor(state, characterId)?.current_work_session_id) throw new Error("career_work_session_active");
  const location = workLocation(state, employment);
  if (!location || currentLocation !== location || player.character.current_location !== location) throw new Error("career_workplace_required");
  if (!schedule.working_weekdays.includes(weekdayForDate(date))) throw new Error("career_shift_not_scheduled");
  const flexible = schedule.flexible === true;
  const latestStart = flexible ? schedule.end_minute - schedule.minimum_session_minutes
    : schedule.start_minute + schedule.clock_in_grace_minutes;
  if (minuteOfDay < schedule.start_minute || minuteOfDay > latestStart || minuteOfDay >= schedule.end_minute) {
    throw new Error("career_shift_not_started");
  }
  if (Object.values(state.workSessions).filter((session) => session.employment_id === employment.employment_id).length >=
    catalog.rules.maximum_sessions_per_employment) throw new Error("career_work_history_limit_reached");
  const sessionId = sessionIdFor(employment.employment_id, date);
  const existing = state.workSessions[sessionId];
  if (existing?.status === "completed") throw new Error("career_shift_already_completed");
  if (existing?.status === "in_progress") return existing;
  for (const other of Object.values(state.workSessions)) {
    if (other.character_id === characterId && other.status === "in_progress") throw new Error("career_work_session_active");
  }
  const timestamp = new Date(now).toISOString();
  const session: CareerWorkSessionRecord = {
    session_id: sessionId,
    employment_id: employment.employment_id,
    character_id: characterId,
    job_id: employment.job_id,
    world_date: cloneDate(date),
    schedule_id: schedule.id,
    workplace_location_id: location,
    scheduled_start_minute: schedule.start_minute,
    scheduled_end_minute: schedule.end_minute,
    started_at_minute: minuteOfDay,
    status: "in_progress",
    worked_minutes: 0,
    gross_earned_ngn: 0,
    performance_score: 0,
    skill_id: job.work_skill_id,
    skill_experience_awarded: 0,
    started_at: timestamp,
    updated_at: timestamp,
  };
  state.workSessions[sessionId] = session;
  employment.current_work_session_id = sessionId;
  employment.updated_at = timestamp;
  appendCareerEvent(state, characterId, "work_session_started", `Clocked in for ${job.title}.`, date,
    minuteOfDay, now, { session_id: sessionId, job_id: job.id }, employment.employment_id);
  return session;
}

function addCareerSkillExperience(
  state: PersistentWorldState,
  characterId: string,
  skillId: string,
  experience: number,
  date: CalendarDate,
  now: number,
): CareerSkillRecord {
  const key = careerSkillKey(characterId, skillId);
  let record = state.careerSkills[key];
  if (!record) {
    record = {
      skill_record_id: `career-skill-${key}`,
      character_id: characterId,
      skill_id: skillId,
      level: 0,
      experience: 0,
      sources: [],
      last_updated_at: new Date(now).toISOString(),
      last_updated_world_date: cloneDate(date),
    };
    state.careerSkills[key] = record;
  }
  record.experience = Math.min(10_000, record.experience + Math.max(0, experience));
  record.level = Math.min(100, Math.floor(record.experience / 100));
  if (!record.sources.includes("career-work-session")) record.sources.push("career-work-session");
  record.last_updated_at = new Date(now).toISOString();
  record.last_updated_world_date = cloneDate(date);
  return record;
}

function maybeCreatePerformanceReview(
  state: PersistentWorldState,
  employment: CareerEmploymentRecord,
  date: CalendarDate,
  now: number,
  catalog: CareerCatalog,
): CareerPerformanceReviewRecord | null {
  const existingReviews = Object.values(state.careerReviews).filter((review) => review.employment_id === employment.employment_id);
  const reviewedThrough = existingReviews.reduce((maximum, review) => Math.max(maximum, review.completed_sessions), 0);
  if (employment.completed_sessions < reviewedThrough + catalog.rules.review_after_completed_sessions) return null;
  const sessions = Object.values(state.workSessions)
    .filter((session) => session.employment_id === employment.employment_id && session.status === "completed")
    .sort((left, right) => left.updated_at.localeCompare(right.updated_at))
    .slice(-catalog.rules.performance_history_window);
  if (sessions.length === 0) return null;
  const score = Math.round(sessions.reduce((sum, session) => sum + session.performance_score, 0) / sessions.length);
  const review: CareerPerformanceReviewRecord = {
    review_id: `career-review-${randomUUID()}`,
    employment_id: employment.employment_id,
    character_id: employment.character_id,
    world_date: cloneDate(date),
    completed_sessions: employment.completed_sessions,
    performance_score: score,
    summary: score >= 80 ? "Consistent attendance and completed work sessions met the prototype review standard."
      : score >= 60 ? "Work sessions were recorded; continue building consistent attendance and skill evidence."
        : "The recorded work pattern needs improvement before a promotion is considered.",
    created_at: new Date(now).toISOString(),
  };
  state.careerReviews[review.review_id] = review;
  employment.performance_score = score;
  appendCareerEvent(state, employment.character_id, "performance_review", review.summary, date,
    state.worldClock.minute_of_day, now, { review_id: review.review_id, score }, employment.employment_id);
  return review;
}

export function completeCareerWorkSession(
  state: PersistentWorldState,
  characterId: string,
  date: CalendarDate = state.worldClock.world_date,
  minuteOfDay: number = state.worldClock.minute_of_day,
  currentLocation?: string,
  now: number = Date.now(),
  catalog: CareerCatalog = loadCareerCatalog(),
): CareerWorkSessionRecord {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("career_character_not_found");
  const employment = findCurrentEmployment(state, characterId);
  const job = catalog.jobs.find((entry) => entry.id === employment.job_id);
  const sessionId = employment.current_work_session_id;
  const session = sessionId ? state.workSessions[sessionId] : undefined;
  if (!job || !session || session.status !== "in_progress") throw new Error("career_work_session_missing");
  personCanWork(player.character, job, date);
  if (compareDates(date, session.world_date) !== 0) throw new Error("career_work_session_date_mismatch");
  if (currentLocation !== session.workplace_location_id || player.character.current_location !== session.workplace_location_id) {
    throw new Error("career_workplace_required");
  }
  const schedule = catalog.work_schedules.find((entry) => entry.id === session.schedule_id);
  if (!schedule) throw new Error("career_schedule_not_found");
  const elapsed = minuteOfDay - session.started_at_minute;
  if (elapsed < schedule.minimum_session_minutes) throw new Error("career_work_session_too_short");
  if (minuteOfDay > schedule.end_minute + schedule.clock_in_grace_minutes || elapsed > schedule.end_minute - session.started_at_minute + schedule.clock_in_grace_minutes) {
    throw new Error("career_work_session_expired");
  }
  const workedMinutes = Math.max(0, Math.min(elapsed, schedule.scheduled_work_minutes));
  const expectedSessionsPerMonth = Math.max(1, schedule.working_weekdays.length * 52 / 12);
  const sessionRate = employment.salary_ngn_monthly / expectedSessionsPerMonth;
  const grossEarned = Math.max(0, Math.floor(sessionRate * Math.min(1, workedMinutes / schedule.scheduled_work_minutes)));
  const lateness = Math.max(0, session.started_at_minute - schedule.start_minute);
  const completionRatio = Math.min(1, workedMinutes / schedule.scheduled_work_minutes);
  const score = Math.max(50, Math.min(100, Math.round(60 + completionRatio * 40 - Math.ceil(lateness / 10))));
  const timestamp = new Date(now).toISOString();
  session.status = "completed";
  session.completed_at_minute = minuteOfDay;
  session.worked_minutes = workedMinutes;
  session.gross_earned_ngn = grossEarned;
  session.performance_score = score;
  session.skill_experience_awarded = job.work_skill_experience_per_session * Math.max(1, Math.floor(workedMinutes / 60));
  session.updated_at = timestamp;
  delete employment.current_work_session_id;
  employment.completed_sessions += 1;
  employment.performance_score = averageEmploymentPerformance(state, employment.employment_id, catalog.rules.performance_history_window);
  employment.updated_at = timestamp;
  addCareerSkillExperience(state, characterId, job.work_skill_id, session.skill_experience_awarded, date, now);
  appendCareerEvent(state, characterId, "work_session_completed", `Completed a work session for ${job.title}.`, date,
    minuteOfDay, now, { session_id: session.session_id, worked_minutes: workedMinutes, gross_earned_ngn: grossEarned, performance_score: score }, employment.employment_id);
  maybeCreatePerformanceReview(state, employment, date, now, catalog);
  return session;
}

function validateLeaveRange(
  startDate: CalendarDate,
  days: number,
  currentDate: CalendarDate,
  maximumDays: number,
): CalendarDate {
  if (!isValidDate(startDate) || !Number.isSafeInteger(days) || days < 1 || days > maximumDays ||
    compareDates(startDate, currentDate) < 0 || compareDates(startDate, addDays(currentDate, 90)) > 0) throw new Error("career_leave_request_invalid");
  return addDays(startDate, days - 1);
}

export function requestCareerLeave(
  state: PersistentWorldState,
  characterId: string,
  employmentId: string,
  leaveType: unknown,
  startDate: CalendarDate,
  days: number,
  date: CalendarDate = state.worldClock.world_date,
  now: number = Date.now(),
  catalog: CareerCatalog = loadCareerCatalog(),
): CareerLeaveRequestRecord {
  const employment = state.employments[employmentId];
  if (!employment || employment.character_id !== characterId || !ACTIVE_EMPLOYMENT_STATUSES.has(employment.status)) throw new Error("career_employment_inactive");
  if (leaveType !== "personal" && leaveType !== "vacation") throw new Error("career_leave_type_invalid");
  const endDate = validateLeaveRange(startDate, days, date, catalog.rules.maximum_leave_days);
  const activeSession = employment.current_work_session_id ? state.workSessions[employment.current_work_session_id] : undefined;
  if (activeSession?.status === "in_progress" && compareDates(activeSession.world_date, startDate) >= 0 &&
    compareDates(activeSession.world_date, endDate) <= 0) throw new Error("career_leave_conflict");
  const overlap = Object.values(state.careerLeaveRequests).some((request) =>
    request.employment_id === employmentId && ["pending", "approved"].includes(request.status) &&
    compareDates(request.start_date, endDate) <= 0 && compareDates(request.end_date, startDate) >= 0);
  if (overlap) throw new Error("career_leave_overlap");
  const timestamp = new Date(now).toISOString();
  const request: CareerLeaveRequestRecord = {
    leave_request_id: `leave-${randomUUID()}`,
    employment_id: employmentId,
    character_id: characterId,
    leave_type: leaveType,
    start_date: cloneDate(startDate),
    end_date: cloneDate(endDate),
    status: "approved",
    reason: leaveType === "vacation" ? "Vacation leave (unpaid prototype leave)." : "Personal leave (unpaid prototype leave).",
    decision_reason: "Automatically approved by the bounded prototype policy; the leave is unpaid and recorded.",
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.careerLeaveRequests[request.leave_request_id] = request;
  appendCareerEvent(state, characterId, "leave_approved", request.reason, date,
    state.worldClock.minute_of_day, now, { leave_request_id: request.leave_request_id, days }, employmentId);
  return request;
}

export function requestCareerPromotion(
  state: PersistentWorldState,
  characterId: string,
  employmentId: string,
  date: CalendarDate = state.worldClock.world_date,
  now: number = Date.now(),
  catalog: CareerCatalog = loadCareerCatalog(),
): CareerEmploymentRecord {
  const player = characterForId(state, characterId);
  const employment = state.employments[employmentId];
  if (!player || !employment || employment.character_id !== characterId || employment.status !== "active") {
    throw new Error("career_employment_inactive");
  }
  if (employment.current_work_session_id || activeLeaveOnDate(state, employment.employment_id, date)) {
    throw new Error("career_promotion_conflict");
  }
  const currentJob = catalog.jobs.find((job) => job.id === employment.job_id);
  if (!currentJob?.promotion_to) throw new Error("career_promotion_unavailable");
  const nextJob = catalog.jobs.find((job) => job.id === currentJob.promotion_to);
  if (!nextJob) throw new Error("career_promotion_unavailable");
  if (employment.completed_sessions < currentJob.minimum_sessions_to_promote ||
    employment.performance_score < currentJob.minimum_performance_to_promote) throw new Error("career_promotion_performance_ineligible");
  const vacancy = Object.values(state.careerVacancies).find((entry) =>
    entry.job_id === nextJob.id && entry.employer_id === employment.employer_id && entry.status === "open" && entry.openings_remaining > 0);
  if (!vacancy) throw new Error("career_promotion_position_unavailable");
  const eligibility = careerEligibility(state, player.character, nextJob, date, { checkVacancy: vacancy, checkCurrentEmployment: false });
  if (!eligibility.eligible) throw new Error("career_promotion_requirements_missing");
  const previousRoleVacancy = state.careerVacancies[employment.vacancy_id];
  if (previousRoleVacancy && previousRoleVacancy.status !== "closed") {
    previousRoleVacancy.openings_remaining = Math.min(previousRoleVacancy.openings_total, previousRoleVacancy.openings_remaining + 1);
    previousRoleVacancy.status = "open";
    previousRoleVacancy.updated_at = new Date(now).toISOString();
  }
  vacancy.openings_remaining -= 1;
  vacancy.status = vacancy.openings_remaining > 0 ? "open" : "filled";
  vacancy.updated_at = new Date(now).toISOString();
  employment.job_id = nextJob.id;
  employment.vacancy_id = vacancy.vacancy_id;
  employment.work_schedule_id = nextJob.schedule_id;
  employment.salary_ngn_monthly = vacancy.monthly_salary_ngn;
  employment.pay_frequency = vacancy.pay_frequency;
  employment.next_payment_date = nextPaymentDate(employment.pay_period_start_date, vacancy.pay_frequency);
  employment.employment_type = vacancy.employment_type;
  employment.updated_at = new Date(now).toISOString();
  appendCareerEvent(state, characterId, "promotion", `Promoted to ${nextJob.title}.`, date,
    state.worldClock.minute_of_day, now, { previous_job_id: currentJob.id, job_id: nextJob.id, salary_ngn_monthly: vacancy.monthly_salary_ngn }, employment.employment_id);
  return employment;
}

function refreshNpcCareers(state: PersistentWorldState, date: CalendarDate, now: number, catalog: CareerCatalog): void {
  const employerByJob = new Map<string, string>();
  for (const vacancy of catalog.vacancies) if (vacancy.employer_id) employerByJob.set(vacancy.job_id, vacancy.employer_id);
  for (const person of Object.values(state.people)) {
    const existing = state.npcCareers[person.person_id];
    let status: CareerEmploymentStatus | "student" | "unemployed" = "unemployed";
    if (person.life_status === "deceased") status = "deceased";
    else if (person.life_status === "retired") status = "retired";
    else if (ageOnDate(person.date_of_birth, date) < catalog.rules.minimum_working_age) status = "student";
    if (status !== "unemployed") {
      if (existing?.employer_id) {
        const employer = state.careerEmployers[existing.employer_id];
        if (employer) employer.employee_character_ids = employer.employee_character_ids.filter((id) => id !== person.person_id);
      }
      state.npcCareers[person.person_id] = {
        person_id: person.person_id, job_id: null, employer_id: null, schedule_id: null, status,
        prototype_fixture: true, profile_source: "deterministic_household_fixture", last_processed_date: cloneDate(date), updated_at: new Date(now).toISOString(),
      };
      continue;
    }
    if (existing?.status === "employed" && existing.job_id && existing.employer_id &&
      catalog.jobs.some((job) => job.id === existing.job_id && job.npc_assignable) && state.careerEmployers[existing.employer_id]) {
      existing.last_processed_date = cloneDate(date);
      existing.updated_at = new Date(now).toISOString();
      const employer = state.careerEmployers[existing.employer_id];
      if (employer && !employer.employee_character_ids.includes(person.person_id)) employer.employee_character_ids.push(person.person_id);
      continue;
    }
    const candidates = catalog.rules.npc_occupation_job_ids.map((id) => catalog.jobs.find((job) => job.id === id))
      .filter((job): job is CareerJobDefinition => !!job && job.npc_assignable && !job.future_stage_only && job.minimum_age <= ageOnDate(person.date_of_birth, date));
    const digest = createHash("sha256").update(person.person_id).digest().readUInt32BE(0);
    const selected = candidates.length > 0 ? candidates[digest % candidates.length] : undefined;
    const employerId = selected ? employerByJob.get(selected.id) : undefined;
    const employer = employerId ? state.careerEmployers[employerId] : undefined;
    const profile = {
      person_id: person.person_id,
      job_id: selected?.id ?? null,
      employer_id: employer?.employer_id ?? null,
      schedule_id: selected?.schedule_id ?? null,
      status: selected && employer ? "employed" as const : "unemployed" as const,
      prototype_fixture: true as const,
      profile_source: "deterministic_household_fixture" as const,
      ...(selected && employer ? { start_date: cloneDate(date) } : {}),
      last_processed_date: cloneDate(date),
      updated_at: new Date(now).toISOString(),
    };
    state.npcCareers[person.person_id] = profile;
    if (employer && !employer.employee_character_ids.includes(person.person_id)) employer.employee_character_ids.push(person.person_id);
  }
}

export function initializeCareerWorldState(
  state: PersistentWorldState,
  now: number = Date.now(),
  catalog: CareerCatalog = loadCareerCatalog(),
): void {
  for (const name of ["careerEmployers", "careerVacancies", "careerApplications", "employments", "workSessions", "careerSkills",
    "careerLicenses", "careerReviews", "careerLeaveRequests", "careerEvents", "salaryPayments", "npcCareers"] as const) {
    const collection = state[name] as Record<string, unknown> | undefined;
    if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
      (state[name] as unknown as Record<string, unknown>) = {};
    }
  }
  const timestamp = new Date(now).toISOString();
  for (const definition of catalog.employers) {
    if (!state.careerEmployers[definition.id]) {
      state.careerEmployers[definition.id] = {
        employer_id: definition.id, name: definition.name, industry_id: definition.industry_id,
        kind: definition.kind, location_id: definition.location_id,
        linked_institution_id: definition.linked_institution_id ?? null,
        description: definition.description, prototype_fixture: definition.prototype_fixture,
        capacity: definition.capacity, active: definition.active, employee_character_ids: [],
        created_at: timestamp, updated_at: timestamp,
      };
    }
  }
  for (const definition of catalog.vacancies) {
    if (!state.careerVacancies[definition.id]) {
      state.careerVacancies[definition.id] = {
        vacancy_id: definition.id, employer_id: definition.employer_id, job_id: definition.job_id,
        monthly_salary_ngn: definition.monthly_salary_ngn, employment_type: definition.employment_type,
        pay_frequency: definition.pay_frequency, openings_total: definition.openings,
        openings_remaining: definition.openings, status: definition.status === "closed" ? "closed" : "open",
        prototype_fixture: true, created_at: timestamp, updated_at: timestamp,
      };
    }
  }
  for (const employer of Object.values(state.careerEmployers)) employer.employee_character_ids = [];
  for (const employment of Object.values(state.employments)) {
    if (!ACTIVE_EMPLOYMENT_STATUSES.has(employment.status) || !employment.employer_id) continue;
    const employer = state.careerEmployers[employment.employer_id];
    if (employer && !employer.employee_character_ids.includes(employment.character_id)) employer.employee_character_ids.push(employment.character_id);
  }
  refreshNpcCareers(state, state.worldClock.world_date, now, catalog);
}

function updateNpcCareerStatuses(state: PersistentWorldState, date: CalendarDate, now: number, catalog: CareerCatalog): void {
  refreshNpcCareers(state, date, now, catalog);
}

export function processCareerWorldMinute(
  state: PersistentWorldState,
  date: CalendarDate,
  minuteOfDay: number,
  now: number = Date.now(),
  catalog: CareerCatalog = loadCareerCatalog(),
): number {
  let invalidated = 0;
  for (const employment of Object.values(state.employments)) {
    const sessionId = employment.current_work_session_id;
    const session = sessionId ? state.workSessions[sessionId] : undefined;
    if (!session || session.status !== "in_progress") continue;
    const schedule = catalog.work_schedules.find((entry) => entry.id === session.schedule_id);
    const expired = compareDates(session.world_date, date) < 0 ||
      (compareDates(session.world_date, date) === 0 && schedule !== undefined &&
        minuteOfDay > session.scheduled_end_minute + schedule.clock_in_grace_minutes);
    if (!expired) continue;
    session.status = "invalidated";
    session.invalidation_reason = "The work session was not completed inside its server-validated shift window.";
    session.updated_at = new Date(now).toISOString();
    delete employment.current_work_session_id;
    employment.updated_at = session.updated_at;
    invalidated += 1;
  }
  return invalidated;
}

export function processCareerWorldDate(
  state: PersistentWorldState,
  date: CalendarDate,
  now: number = Date.now(),
  catalog: CareerCatalog = loadCareerCatalog(),
  account: SalaryAccountPort = prototypeSalaryAccountPort(state, catalog),
): ApplicationDecision[] {
  const decisions = processPendingCareerApplications(state, date, now, catalog);
  updateNpcCareerStatuses(state, date, now, catalog);
  for (const leave of Object.values(state.careerLeaveRequests)) {
    if (leave.status === "approved" && compareDates(leave.end_date, date) < 0) {
      leave.status = "completed";
      leave.updated_at = new Date(now).toISOString();
    }
  }
  processCareerWorldMinute(state, date, state.worldClock.minute_of_day, now, catalog);
  for (const employment of Object.values(state.employments)) {
    if (!ACTIVE_EMPLOYMENT_STATUSES.has(employment.status)) continue;
    const player = characterForId(state, employment.character_id);
    if (!player || player.character.life_status === "deceased") {
      closeEmployment(state, employment, "deceased", "Employment ended because the character is deceased; no future wages are paid.", date,
        state.worldClock.minute_of_day, now, account, false);
      continue;
    }
    const job = catalog.jobs.find((entry) => entry.id === employment.job_id);
    if (player.character.life_status === "retired" && !job?.allow_retired) {
      closeEmployment(state, employment, "retired", "Employment ended under the shared retirement rule.", date,
        state.worldClock.minute_of_day, now, account, true);
      continue;
    }
    const leave = activeLeaveOnDate(state, employment.employment_id, date);
    if (leave) employment.status = "on_leave";
    else if (employment.status === "on_leave") employment.status = "active";
    if (employment.status === "suspended") continue;
    if (employment.status === "on_leave" || player.character.life_status === "alive" || job?.allow_retired) {
      postDuePayroll(state, employment, date, now, account);
    }
  }
  return decisions;
}

export function searchCareerJobsForCharacter(
  state: PersistentWorldState,
  characterId: string,
  query: { readonly text?: string; readonly industry_id?: string; readonly location_id?: string } = {},
  catalog: CareerCatalog = loadCareerCatalog(),
): CareerJobSearchEntry[] {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("career_character_not_found");
  return searchCareerJobs(state, player.character, query, catalog);
}

export function requestCareerRetirement(
  state: PersistentWorldState,
  characterId: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  account: SalaryAccountPort = prototypeSalaryAccountPort(state),
): number {
  return retireCareerEmployments(state, characterId, date, minuteOfDay, now, account);
}

export function buildCareerProfile(
  state: PersistentWorldState,
  character: CharacterRecord,
  catalog: CareerCatalog = loadCareerCatalog(),
): CareerProfileSnapshot {
  const characterId = character.character_id;
  const allSkillIds = new Set<string>();
  for (const skill of character.education_record?.skills ?? []) allSkillIds.add(skill.skill_id);
  for (const skill of Object.values(state.careerSkills)) if (skill.character_id === characterId) allSkillIds.add(skill.skill_id);
  const skills = [...allSkillIds].map((skillId) => {
    const educationSkill = character.education_record?.skills?.find((skill) => skill.skill_id === skillId);
    const careerSkill = state.careerSkills[careerSkillKey(characterId, skillId)];
    const definition = catalog.skills.find((skill) => skill.id === skillId) ??
      { id: skillId, name: skillId.replace(/^skill:/, "").replace(/-/gu, " "), category: "education" };
    const sources = new Set<string>(careerSkill?.sources ?? []);
    if (educationSkill) sources.add("education-record");
    return {
      skill_id: skillId,
      name: definition.name,
      category: definition.category,
      level: Math.max(educationSkill?.level ?? 0, careerSkill?.level ?? 0),
      experience: Math.max(educationSkill?.experience ?? 0, careerSkill?.experience ?? 0),
      sources: [...sources],
      last_updated_at: careerSkill?.last_updated_at ?? character.updated_at,
      last_updated_world_date: careerSkill?.last_updated_world_date ?? cloneDate(state.worldClock.world_date),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  const employmentRecords = Object.values(state.employments).filter((entry) => entry.character_id === characterId)
    .sort((left, right) => right.start_date.year - left.start_date.year || right.start_date.month - left.start_date.month || right.start_date.day - left.start_date.day)
    .slice(0, 100);
  const employmentHistory = employmentRecords.map((entry) => employmentProfile(state, entry, character, catalog));
  const currentEmployment = employmentHistory.find((entry) => ACTIVE_EMPLOYMENT_STATUSES.has(entry.status)) ?? null;
  const household = state.households[character.household_id];
  const householdOccupations = (household?.member_ids ?? []).filter((personId) => personId !== characterId).flatMap((personId) => {
    const person = state.people[personId];
    const profile = state.npcCareers[personId];
    if (!person || !profile) return [];
    const job = profile.job_id ? catalog.jobs.find((entry) => entry.id === profile.job_id) : undefined;
    const employer = profile.employer_id ? state.careerEmployers[profile.employer_id] : undefined;
    return [{ person_id: personId, name: person.name, age: person.age, status: profile.status, job_title: job?.title ?? null,
      employer_name: employer?.name ?? null, schedule_id: profile.schedule_id, prototype_fixture: true }];
  });
  const recent = <T extends { readonly created_at?: string }>(entries: T[], maximum = 100): T[] => entries
    .sort((left, right) => (right.created_at ?? "").localeCompare(left.created_at ?? "")).slice(0, maximum);
  return {
    schema_version: 1,
    character_id: characterId,
    retirement_minimum_age: loadLifeCatalog().old_age.retirement_minimum_age_years,
    skills,
    licenses: Object.values(state.careerLicenses).filter((entry) => entry.character_id === characterId),
    applications: recent(Object.values(state.careerApplications).filter((entry) => entry.character_id === characterId)),
    employment_history: employmentHistory,
    current_employment: currentEmployment,
    work_sessions: Object.values(state.workSessions).filter((entry) => entry.character_id === characterId)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at)).slice(0, 100),
    salary_payments: Object.values(state.salaryPayments).filter((entry) => entry.character_id === characterId)
      .sort((left, right) => right.posted_at.localeCompare(left.posted_at)).slice(0, 100),
    performance_reviews: recent(Object.values(state.careerReviews).filter((entry) => entry.character_id === characterId)),
    leave_requests: recent(Object.values(state.careerLeaveRequests).filter((entry) => entry.character_id === characterId)),
    career_events: recent(Object.values(state.careerEvents).filter((entry) => entry.character_id === characterId)),
    household_occupations: householdOccupations,
  };
}

const CAREER_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  career_character_not_found: "Your character record is not available in this world.",
  career_query_invalid: "Search text must be 80 characters or fewer.",
  career_vacancy_not_found: "That vacancy is no longer available.",
  career_job_not_found: "The configured job record is not available.",
  career_application_limit_reached: "The prototype application-history limit has been reached.",
  career_application_ineligible: "You do not currently meet the server-checked requirements for this vacancy.",
  career_application_not_found: "That application does not belong to this character.",
  career_application_not_withdrawable: "Only an undecided application can be withdrawn.",
  career_employment_not_found: "That employment record does not belong to this character.",
  career_employment_inactive: "There is no active employment for that action.",
  career_employer_unauthorized: "Only an authorized employer service can end this employment.",
  career_termination_reason_required: "A short employer-side reason is required.",
  character_deceased: "Deceased characters cannot work or retire.",
  career_retired_character: "This role is not available to a retired character.",
  career_age_ineligible: "Your current server-derived age does not meet this role's requirement.",
  career_employment_suspended: "This employment is suspended and cannot start a shift.",
  career_leave_active: "Approved leave is active for this date.",
  career_work_session_active: "Finish or let the current work session expire before starting another.",
  career_workplace_required: "Travel to the server-recorded workplace before starting or completing work.",
  career_shift_not_scheduled: "There is no shift scheduled for this world date.",
  career_shift_not_started: "The server schedule does not allow clock-in at this time.",
  career_work_history_limit_reached: "The prototype work-history limit has been reached for this employment.",
  career_shift_already_completed: "Today's shift has already been completed.",
  career_work_session_missing: "There is no in-progress work session to complete.",
  career_work_session_date_mismatch: "Work sessions must be completed on their server-recorded date.",
  career_work_session_too_short: "Stay on shift until the minimum work-session time has elapsed.",
  career_work_session_expired: "The scheduled shift window has ended; this session cannot be completed.",
  career_schedule_not_found: "The role's configured schedule is unavailable.",
  career_leave_type_invalid: "Choose a supported personal or vacation leave type.",
  career_leave_request_invalid: "Leave must be 1–14 days, begin today or later, and start within 90 world days.",
  career_leave_overlap: "This leave overlaps another approved or pending leave period.",
  career_leave_conflict: "An active work session overlaps the requested leave dates.",
  career_promotion_unavailable: "There is no configured next role for this employment.",
  career_promotion_conflict: "Finish your shift and any active leave before requesting a promotion.",
  career_promotion_performance_ineligible: "The required completed sessions and performance score have not been reached.",
  career_promotion_position_unavailable: "There is no open same-employer position for the next role.",
  career_promotion_requirements_missing: "The next role's qualifications, skills, registration, or employer capacity are not satisfied.",
  career_salary_payment_deferred: "Earned pay could not be credited safely; employment closure was deferred for reconciliation.",
  career_salary_balance_limit: "The existing prototype balance cannot accept this payment yet; payroll will retry safely.",
  retirement_age_ineligible: "Retirement is available only at the configurable Stage 5 retirement age.",
};

export function careerErrorMessage(code: string): string {
  return CAREER_ERROR_MESSAGES[code] ?? "The career request could not be completed; no client-supplied outcome was applied.";
}

export function issueCareerLicenseServerSide(
  state: PersistentWorldState,
  characterId: string,
  licenseId: string,
  issuer: string,
  date: CalendarDate = state.worldClock.world_date,
  now: number = Date.now(),
): CareerLicenseRecord {
  if (!characterForId(state, characterId)) throw new Error("career_character_not_found");
  if (!/^license:[a-z0-9-]{3,100}$/u.test(licenseId) || !issuer.trim() || issuer.length > 120) throw new Error("career_license_invalid");
  const id = licenseKey(characterId, licenseId);
  const existing = state.careerLicenses[id];
  if (existing?.status === "active") return existing;
  const record: CareerLicenseRecord = {
    license_record_id: `career-license-${id}`,
    character_id: characterId,
    license_id: licenseId,
    issuer: issuer.trim(),
    issued_at: new Date(now).toISOString(),
    world_date: cloneDate(date),
    status: "active",
  };
  state.careerLicenses[id] = record;
  appendCareerEvent(state, characterId, "professional_license_recorded", "A server-authorized prototype registration was recorded.", date,
    state.worldClock.minute_of_day, now, { license_id: licenseId, issuer: issuer.trim() });
  return record;
}
