import type { CalendarDate } from "../life/types.js";

export type CareerEducationLevel = "none" | "secondary" | "vocational" | "tertiary";
export type CareerPayFrequency = "weekly" | "biweekly" | "monthly";
export type CareerEmploymentType =
  | "full_time"
  | "part_time"
  | "shift"
  | "contract"
  | "temporary"
  | "seasonal"
  | "casual"
  | "apprenticeship"
  | "freelance"
  | "self_employed";
export type CareerEmploymentStatus =
  | "active"
  | "on_leave"
  | "suspended"
  | "resigned"
  | "terminated"
  | "contract_completed"
  | "retired"
  | "deceased";
export type CareerApplicationStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "interview_requested"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "expired";
export type CareerSessionStatus = "in_progress" | "completed" | "invalidated" | "cancelled";
export type CareerLeaveStatus = "pending" | "approved" | "rejected" | "cancelled" | "completed";

export interface CareerIndustryDefinition {
  readonly id: string;
  readonly label: string;
  readonly code: string;
}

export interface CareerSkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: string;
}

export interface CareerWorkSchedule {
  readonly id: string;
  readonly label: string;
  readonly working_weekdays: readonly string[];
  readonly start_minute: number;
  readonly end_minute: number;
  readonly scheduled_work_minutes: number;
  readonly minimum_session_minutes: number;
  readonly clock_in_grace_minutes: number;
  readonly weekly_hours: number;
  readonly flexible?: boolean;
}

export interface CareerJobDefinition {
  readonly id: string;
  readonly title: string;
  readonly industry_id: string;
  readonly track_id: string;
  readonly career_level: number;
  readonly description: string;
  readonly duties: string;
  readonly minimum_age: number;
  readonly maximum_weekly_hours: number;
  readonly minimum_education: CareerEducationLevel;
  readonly required_qualifications: readonly string[];
  readonly required_qualification_groups: readonly (readonly string[])[];
  readonly required_licenses: readonly string[];
  readonly required_skills: readonly { readonly skill_id: string; readonly minimum_level: number }[];
  readonly career_links: readonly string[];
  readonly regulated: boolean;
  readonly allow_retired: boolean;
  readonly future_stage_only: boolean;
  readonly employment_types: readonly CareerEmploymentType[];
  readonly default_employment_type: CareerEmploymentType;
  readonly schedule_id: string;
  readonly salary_range_monthly_ngn: { readonly minimum: number; readonly maximum: number };
  readonly work_skill_id: string;
  readonly work_skill_experience_per_session: number;
  readonly minimum_experience_sessions: number;
  readonly promotion_to: string | null;
  readonly minimum_sessions_to_promote: number;
  readonly minimum_performance_to_promote: number;
  readonly npc_assignable: boolean;
}

export interface CareerEmployerDefinition {
  readonly id: string;
  readonly name: string;
  readonly industry_id: string;
  readonly kind: string;
  readonly location_id: string;
  readonly linked_institution_id?: string | null;
  readonly description: string;
  readonly prototype_fixture: boolean;
  readonly capacity: number;
  readonly active: boolean;
}

export interface CareerVacancyDefinition {
  readonly id: string;
  readonly employer_id: string | null;
  readonly job_id: string;
  readonly monthly_salary_ngn: number;
  readonly employment_type: CareerEmploymentType;
  readonly pay_frequency: CareerPayFrequency;
  readonly openings: number;
  readonly status: "open" | "closed";
}

export interface CareerCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly rules: {
    readonly application_review_days: number;
    readonly minimum_working_age: number;
    readonly maximum_search_results: number;
    readonly maximum_applications_per_character: number;
    readonly maximum_sessions_per_employment: number;
    readonly maximum_history_records_per_character: number;
    readonly maximum_leave_days: number;
    readonly minimum_terminal_age_from_life_catalog: boolean;
    readonly maximum_salary_monthly_ngn: number;
    readonly minimum_payable_balance_ngn: number;
    readonly maximum_payable_balance_ngn: number;
    readonly review_after_completed_sessions: number;
    readonly performance_history_window: number;
    readonly npc_occupation_job_ids: readonly string[];
  };
  readonly industries: readonly CareerIndustryDefinition[];
  readonly skills: readonly CareerSkillDefinition[];
  readonly work_schedules: readonly CareerWorkSchedule[];
  readonly jobs: readonly CareerJobDefinition[];
  readonly employers: readonly CareerEmployerDefinition[];
  readonly vacancies: readonly CareerVacancyDefinition[];
}

export interface CareerEmployerRecord {
  readonly employer_id: string;
  readonly name: string;
  readonly industry_id: string;
  readonly kind: string;
  readonly location_id: string;
  readonly linked_institution_id: string | null;
  readonly description: string;
  readonly prototype_fixture: boolean;
  readonly capacity: number;
  active: boolean;
  employee_character_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface CareerVacancyRecord {
  readonly vacancy_id: string;
  readonly employer_id: string | null;
  readonly job_id: string;
  readonly monthly_salary_ngn: number;
  readonly employment_type: CareerEmploymentType;
  readonly pay_frequency: CareerPayFrequency;
  readonly openings_total: number;
  openings_remaining: number;
  status: "open" | "filled" | "closed";
  readonly prototype_fixture: boolean;
  readonly created_at: string;
  updated_at: string;
}

export interface CareerApplicationRecord {
  readonly application_id: string;
  readonly character_id: string;
  readonly vacancy_id: string;
  readonly job_id: string;
  readonly employer_id: string | null;
  status: CareerApplicationStatus;
  readonly created_at: string;
  readonly submitted_world_date: CalendarDate;
  readonly review_due_date: CalendarDate;
  readonly eligibility_score: number;
  updated_at: string;
  decision_reason: string;
  employment_id?: string;
}

export interface CareerEmploymentRecord {
  readonly employment_id: string;
  readonly character_id: string;
  readonly application_id: string;
  vacancy_id: string;
  readonly employer_id: string | null;
  employer_name_at_start: string;
  job_id: string;
  employment_type: CareerEmploymentType;
  status: CareerEmploymentStatus;
  salary_ngn_monthly: number;
  pay_frequency: CareerPayFrequency;
  work_schedule_id: string;
  readonly start_date: CalendarDate;
  end_date?: CalendarDate;
  pay_period_start_date: CalendarDate;
  next_payment_date: CalendarDate;
  completed_sessions: number;
  performance_score: number;
  current_work_session_id?: string;
  created_at: string;
  updated_at: string;
  end_reason?: string;
}

export interface CareerWorkSessionRecord {
  readonly session_id: string;
  readonly employment_id: string;
  readonly character_id: string;
  readonly job_id: string;
  readonly world_date: CalendarDate;
  readonly schedule_id: string;
  readonly workplace_location_id: string;
  readonly scheduled_start_minute: number;
  readonly scheduled_end_minute: number;
  readonly started_at_minute: number;
  status: CareerSessionStatus;
  completed_at_minute?: number;
  worked_minutes: number;
  gross_earned_ngn: number;
  performance_score: number;
  readonly skill_id: string;
  skill_experience_awarded: number;
  started_at: string;
  updated_at: string;
  payroll_payment_id?: string;
  invalidation_reason?: string;
}

export interface CareerSkillRecord {
  readonly skill_record_id: string;
  readonly character_id: string;
  readonly skill_id: string;
  level: number;
  experience: number;
  sources: string[];
  last_updated_at: string;
  last_updated_world_date: CalendarDate;
}

export interface CareerLicenseRecord {
  readonly license_record_id: string;
  readonly character_id: string;
  readonly license_id: string;
  readonly issuer: string;
  readonly issued_at: string;
  readonly world_date: CalendarDate;
  readonly status: "active" | "suspended" | "revoked";
}

export interface CareerPerformanceReviewRecord {
  readonly review_id: string;
  readonly employment_id: string;
  readonly character_id: string;
  readonly world_date: CalendarDate;
  readonly completed_sessions: number;
  readonly performance_score: number;
  readonly summary: string;
  readonly created_at: string;
}

export interface CareerLeaveRequestRecord {
  readonly leave_request_id: string;
  readonly employment_id: string;
  readonly character_id: string;
  readonly leave_type: "personal" | "vacation";
  readonly start_date: CalendarDate;
  readonly end_date: CalendarDate;
  status: CareerLeaveStatus;
  readonly reason: string;
  decision_reason: string;
  readonly created_at: string;
  updated_at: string;
}

export interface CareerEventRecord {
  readonly event_id: string;
  readonly character_id: string;
  readonly type: string;
  readonly world_date: CalendarDate;
  readonly minute_of_day: number;
  readonly summary: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
  readonly created_at: string;
  readonly employment_id?: string;
  readonly application_id?: string;
}

export interface SalaryPaymentRecord {
  readonly payment_id: string;
  readonly employment_id: string;
  readonly character_id: string;
  readonly employer_id: string | null;
  readonly amount_ngn: number;
  readonly pay_frequency: CareerPayFrequency;
  readonly pay_period_start_date: CalendarDate;
  readonly pay_period_end_date: CalendarDate;
  readonly paid_at_world_date: CalendarDate;
  readonly final_payment: boolean;
  readonly work_session_ids: readonly string[];
  readonly posted_at: string;
}

export interface NpcCareerRecord {
  readonly person_id: string;
  job_id: string | null;
  employer_id: string | null;
  schedule_id: string | null;
  status: "student" | "employed" | "unemployed" | "retired" | "deceased";
  readonly prototype_fixture: true;
  readonly profile_source: "deterministic_household_fixture";
  start_date?: CalendarDate;
  last_processed_date: CalendarDate;
  updated_at: string;
}

export interface CareerEmploymentSnapshot extends CareerEmploymentRecord {
  readonly job_title: string;
  readonly work_location_id: string;
  readonly schedule: CareerWorkSchedule | null;
  readonly promotion_available: boolean;
  readonly promotion_job_title: string | null;
}

export interface CareerProfileSnapshot {
  readonly schema_version: 1;
  readonly character_id: string;
  readonly retirement_minimum_age: number;
  readonly skills: readonly Record<string, unknown>[];
  readonly licenses: readonly CareerLicenseRecord[];
  readonly applications: readonly CareerApplicationRecord[];
  readonly employment_history: readonly CareerEmploymentSnapshot[];
  readonly current_employment: CareerEmploymentSnapshot | null;
  readonly work_sessions: readonly CareerWorkSessionRecord[];
  readonly salary_payments: readonly SalaryPaymentRecord[];
  readonly performance_reviews: readonly CareerPerformanceReviewRecord[];
  readonly leave_requests: readonly CareerLeaveRequestRecord[];
  readonly career_events: readonly CareerEventRecord[];
  readonly household_occupations: readonly Record<string, unknown>[];
}

export interface CareerJobSearchEntry {
  readonly vacancy_id: string;
  readonly job_id: string;
  readonly title: string;
  readonly industry_id: string;
  readonly industry_label: string;
  readonly career_level: number;
  readonly description: string;
  readonly duties: string;
  readonly employer_id: string | null;
  readonly employer_name: string;
  readonly employer_description: string;
  readonly prototype_fixture: boolean;
  readonly employer_employee_count: number;
  readonly work_location_id: string;
  readonly salary_range_monthly_ngn: { readonly minimum: number; readonly maximum: number };
  readonly monthly_salary_offer_ngn: number;
  readonly pay_frequency: CareerPayFrequency;
  readonly employment_type: CareerEmploymentType;
  readonly schedule: CareerWorkSchedule;
  readonly minimum_age: number;
  readonly minimum_education: CareerEducationLevel;
  readonly required_qualifications: readonly string[];
  readonly required_qualification_groups: readonly (readonly string[])[];
  readonly required_licenses: readonly string[];
  readonly required_skills: readonly { readonly skill_id: string; readonly minimum_level: number }[];
  readonly eligible: boolean;
  readonly missing_requirements: readonly string[];
  readonly openings_remaining: number;
  readonly application_status: CareerApplicationStatus | null;
}

export interface PersistentCareerMaps {
  careerEmployers: Record<string, CareerEmployerRecord>;
  careerVacancies: Record<string, CareerVacancyRecord>;
  careerApplications: Record<string, CareerApplicationRecord>;
  employments: Record<string, CareerEmploymentRecord>;
  workSessions: Record<string, CareerWorkSessionRecord>;
  careerSkills: Record<string, CareerSkillRecord>;
  careerLicenses: Record<string, CareerLicenseRecord>;
  careerReviews: Record<string, CareerPerformanceReviewRecord>;
  careerLeaveRequests: Record<string, CareerLeaveRequestRecord>;
  careerEvents: Record<string, CareerEventRecord>;
  salaryPayments: Record<string, SalaryPaymentRecord>;
  npcCareers: Record<string, NpcCareerRecord>;
}
