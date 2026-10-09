export type EducationEnrollmentStatus =
  | "enrolled"
  | "completed"
  | "left"
  | "transferred";

export type EducationProgressionStatus =
  | "active"
  | "term_result_ready"
  | "eligible_to_promote"
  | "remediation_available"
  | "final_exam_eligible"
  | "secondary_complete"
  | "tertiary_active"
  | "tertiary_complete"
  | "vocational_active"
  | "left_school";

export interface EducationSubject {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly legacy_score_key: string;
}

export interface EducationQuestion {
  readonly id: string;
  readonly subject_id: string;
  readonly class_ids: readonly string[];
  readonly prompt: string;
  readonly choices: readonly string[];
  readonly correct_choice_index: number;
  readonly original_game_content: boolean;
}

export interface EducationInstitution {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly ownership: string;
  readonly fictional: boolean;
  readonly capacity: number;
  readonly program_ids?: readonly string[];
  readonly class_ids?: readonly string[];
  readonly curriculum_id?: string;
  readonly application_fee_ngn?: number;
  readonly registration_fee_ngn?: number;
  readonly tuition_per_term_ngn?: number;
  readonly annual_fee_ngn?: number;
  readonly transport_cost_ngn?: number;
  readonly duration_years?: number;
  readonly geographic_location: {
    readonly world_id: "nigeria-main";
    readonly region_id: string;
    readonly country_id: "NG";
    readonly state_id: string;
    readonly lga_id: string;
    readonly settlement_id: string;
    readonly state_name: string;
    readonly lga_name: string;
    readonly settlement_name: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly coordinate_origin: "synthetic_gameplay_anchor";
    readonly notice: string;
  };
}

export interface EducationProgram {
  readonly id: string;
  readonly institution_id: string;
  readonly kind: "university" | "polytechnic" | "college_of_education";
  readonly name: string;
  readonly award: string;
  readonly duration_years: number;
  readonly duration_semesters: number;
  readonly minimum_age: number;
  readonly requirements: {
    readonly minimum_final_credits: number;
    readonly required_subject_ids: readonly string[];
    readonly minimum_secondary_average: number;
    readonly required_qualification_ids?: readonly string[];
  };
  readonly tuition_per_term_ngn: number;
  readonly application_fee_ngn: number;
  readonly registration_fee_ngn: number;
  readonly course_ids: readonly string[];
  readonly career_links: readonly string[];
  readonly capacity: number;
}

export interface EducationCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly calendar: {
    readonly weekday_labels: readonly string[];
    readonly school_days_of_week: readonly number[];
    readonly term_length_game_days: number;
    readonly terms_per_academic_year: number;
    readonly starting_class_by_age: Readonly<Record<string, string>>;
    readonly late_grace_minutes: number;
    readonly class_duration_minutes: number;
  };
  readonly starting_diagnostic_scores: Readonly<Record<string, number>>;
  readonly skills: readonly {
    readonly id: string;
    readonly name: string;
    readonly category: string;
    readonly career_links: readonly string[];
  }[];
  readonly grading: {
    readonly id: string;
    readonly assessment_weights: Readonly<Record<string, number>>;
    readonly attendance_weight: number;
    readonly grade_bands: readonly { readonly grade: string; readonly minimum_score: number; readonly label: string }[];
    readonly pass_score: number;
    readonly promotion_minimum_average: number;
    readonly core_subject_minimum_score: number;
    readonly final_exam_minimum_credits: number;
    readonly final_exam_required_subject_ids: readonly string[];
    readonly exam_credit_score: number;
  };
  readonly subjects: readonly EducationSubject[];
  readonly school_years: readonly {
    readonly id: string;
    readonly label: string;
    readonly stage: string;
    readonly next_class_id: string | null;
    readonly sort_order: number;
  }[];
  readonly curricula: readonly {
    readonly id: string;
    readonly name: string;
    readonly class_ids: readonly string[];
    readonly compulsory_subject_ids: readonly string[];
    readonly elective_groups: readonly {
      readonly id: string;
      readonly minimum_choices: number;
      readonly maximum_choices: number;
      readonly subject_ids: readonly string[];
    }[];
    readonly default_elective_subject_ids: readonly string[];
    readonly maximum_subject_count: number;
    readonly assessment_types: readonly string[];
  }[];
  readonly institutions: readonly EducationInstitution[];
  readonly classrooms: readonly {
    readonly id: string;
    readonly name: string;
    readonly institution_id: string;
    readonly class_id: string;
    readonly capacity: number;
    readonly facility_ids: readonly string[];
    readonly map_location_id: string;
  }[];
  readonly teachers: readonly {
    readonly id: string;
    readonly name: string;
    readonly institution_id: string;
    readonly subject_ids: readonly string[];
    readonly classroom_ids: readonly string[];
    readonly schedule_ids: readonly string[];
  }[];
  readonly npc_students: readonly {
    readonly id: string;
    readonly name: string;
    readonly age: number;
    readonly institution_id: string;
    readonly class_id: string;
    readonly academic_state: string;
    readonly score_band: string;
    readonly attendance_band: string;
    readonly fictional: boolean;
  }[];
  readonly timetable: readonly EducationTimetableEntry[];
  readonly activities: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
    readonly duration_minutes: number;
    readonly energy_cost: number;
    readonly academic_bonus: number;
    readonly relationship_bonus: number;
    readonly location_id: string;
  }[];
  readonly assessment_types: readonly { readonly id: string; readonly label: string }[];
  readonly questions: readonly EducationQuestion[];
  readonly final_examination: {
    readonly id: string;
    readonly name: string;
    readonly notice: string;
    readonly registration_fee_ngn: number;
    readonly retake_fee_ngn: number;
    readonly minimum_subjects: number;
    readonly minimum_credits: number;
    readonly required_credit_subject_ids: readonly string[];
    readonly exam_days_after_registration: number;
    readonly pass_score: number;
  };
  readonly tertiary_calendar: {
    readonly id: string;
    readonly semesters_per_year: number;
    readonly term_length_game_days: number;
    readonly credit_pass_score: number;
    readonly good_standing_average: number;
    readonly assessment_weight: number;
  };
  readonly programs: readonly EducationProgram[];
  readonly courses: readonly {
    readonly id: string;
    readonly name: string;
    readonly subject_id: string;
    readonly assessment_type: string;
    readonly question_id: string;
  }[];
  readonly training_programs: readonly {
    readonly id: string;
    readonly name: string;
    readonly skill_id: string;
    readonly institution_id: string;
    readonly duration_sessions: number;
    readonly session_cost_ngn: number;
    readonly master_teacher_id: string;
    readonly career_links: readonly string[];
    readonly certificate_name: string;
  }[];
  readonly apprenticeship_defaults: {
    readonly minimum_sessions: number;
    readonly practice_time_minutes: number;
    readonly completion_skill_level: number;
    readonly allow_concurrent_programs: boolean;
  };
  readonly scholarships: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: "merit" | "need_based";
    readonly minimum_secondary_average: number;
    readonly maximum_money_ngn: number | null;
    readonly award_amount_ngn: number;
    readonly duration_terms: number;
    readonly capacity: number;
  }[];
  readonly family_support: {
    readonly maximum_requests_per_term: number;
    readonly support_amount_ngn: number;
    readonly minimum_guardians: number;
    readonly eligibility_maximum_player_balance_ngn: number;
  };
  readonly education_costs: {
    readonly books_and_materials_ngn: number;
    readonly school_transport_one_way_ngn: number;
    readonly tertiary_accommodation_per_term_ngn: number;
    readonly work_study_note: string;
  };
}

export interface EducationTimetableEntry {
  readonly id: string;
  readonly days_of_week: readonly number[];
  readonly class_ids: readonly string[];
  readonly start_minute: number;
  readonly duration_minutes: number;
  readonly kind: "lesson" | "activity" | "break";
  readonly activity_id?: string;
  readonly label?: string;
  readonly subject_id?: string;
  readonly subject_slot_id?: string;
  readonly location_id: string;
  readonly classroom_id: string | null;
  readonly teacher_id: string | null;
  readonly assessment_type?: string;
}

export interface StudentAttendanceRecord {
  readonly attendance_id: string;
  readonly academic_year: number;
  readonly term: number;
  readonly day: number;
  readonly schedule_id: string;
  readonly class_id: string;
  readonly subject_id: string | null;
  readonly status: "present" | "late" | "absent" | "excused";
  readonly minutes_late: number;
  readonly recorded_at_minute: number;
}

export interface StudentAssessmentRecord {
  readonly assessment_id: string;
  readonly academic_year: number;
  readonly term: number;
  readonly day: number;
  readonly subject_id: string;
  readonly assessment_type: string;
  readonly score: number;
  readonly maximum_score: number;
  readonly question_id: string;
  readonly source: "lesson" | "final_exam" | "tertiary_course" | "teacher_entry";
}

export interface StudentSubjectResult {
  readonly subject_id: string;
  readonly score: number;
  readonly grade: string;
  readonly label: string;
  readonly passed: boolean;
}

export interface EducationTermResult {
  readonly result_id: string;
  readonly academic_year: number;
  readonly term: number;
  readonly published_day: number;
  readonly attendance_percent: number;
  readonly overall_average: number;
  readonly overall_grade: string;
  readonly promotion_eligible: boolean;
  readonly subject_results: readonly StudentSubjectResult[];
}

export interface EducationEvent {
  readonly event_id: string;
  readonly type: string;
  readonly day: number;
  readonly academic_year: number;
  readonly term: number;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export interface StudentEducationRecord {
  readonly schema_version: 1;
  readonly student_id: string;
  readonly character_id: string;
  school_id: string;
  current_class_id: string;
  academic_year: number;
  term: number;
  term_start_day: number;
  enrollment_status: EducationEnrollmentStatus;
  progression_status: EducationProgressionStatus;
  subject_ids: string[];
  readonly attendance_records: StudentAttendanceRecord[];
  assessment_records: StudentAssessmentRecord[];
  readonly term_results: EducationTermResult[];
  readonly final_exam_registrations: FinalExamRegistration[];
  readonly final_exam_attempts: FinalExamAttempt[];
  readonly qualifications: QualificationRecord[];
  readonly skills: StudentSkillRecord[];
  readonly admission_applications: AdmissionApplication[];
  tertiary_enrollment: TertiaryEnrollment | null;
  readonly vocational_enrollments: VocationalEnrollment[];
  readonly apprenticeships: ApprenticeshipRecord[];
  readonly scholarships: ScholarshipAward[];
  readonly education_events: EducationEvent[];
  readonly family_support_claims: { academic_year: number; term: number; amount_ngn: number; day: number }[];
}

export interface FinalExamRegistration {
  readonly registration_id: string;
  readonly examination_id: string;
  readonly registered_day: number;
  readonly subjects: string[];
  readonly status: "registered" | "in_progress" | "results_published";
  readonly certificate_eligible: boolean;
}

export interface FinalExamAttempt {
  readonly attempt_id: string;
  readonly registration_id: string;
  readonly subject_id: string;
  readonly day: number;
  readonly score: number;
  readonly grade: string;
  readonly credit: boolean;
  readonly question_id: string;
}

export interface StudentSkillRecord {
  readonly skill_id: string;
  level: number;
  experience: number;
  readonly career_links: readonly string[];
  certificate_ids: string[];
}

export interface QualificationRecord {
  readonly id: string;
  readonly name: string;
  readonly award: string;
  readonly institution_id: string;
  readonly completed_day: number;
  readonly career_links: readonly string[];
}

export interface AdmissionApplication {
  readonly application_id: string;
  readonly program_id: string;
  readonly institution_id: string;
  readonly submitted_day: number;
  status: "offered" | "declined" | "accepted" | "rejected" | "waitlisted";
  readonly decision_reason: string;
}

export interface TertiaryEnrollment {
  readonly institution_id: string;
  readonly program_id: string;
  readonly program_kind: string;
  readonly award: string;
  semester: number;
  readonly duration_semesters: number;
  semester_start_day: number;
  status: "active" | "good_standing" | "probation" | "completed";
  readonly course_ids: string[];
  readonly course_scores: Record<string, number[]>;
}

export interface VocationalEnrollment {
  readonly enrollment_id: string;
  readonly training_program_id: string;
  readonly institution_id: string;
  readonly started_day: number;
  sessions_completed: number;
  readonly duration_sessions: number;
  status: "active" | "completed";
  readonly skill_id: string;
}

export interface ApprenticeshipRecord {
  readonly apprenticeship_id: string;
  readonly training_program_id: string;
  readonly skill_id: string;
  readonly master_teacher_id: string;
  readonly started_day: number;
  sessions_completed: number;
  readonly required_sessions: number;
  status: "active" | "completed";
  skill_level: number;
}

export interface ScholarshipAward {
  readonly scholarship_id: string;
  readonly name: string;
  readonly kind: "merit" | "need_based";
  readonly awarded_day: number;
  funding_balance_ngn: number;
  readonly duration_terms: number;
  remaining_terms: number;
  status: "awarded" | "exhausted" | "expired";
}

export interface EducationCommandContext {
  readonly day: number;
  readonly minuteOfDay: number;
  readonly age: number;
  readonly money: number;
  readonly household: Record<string, unknown>;
  readonly currentLocation: string;
}

export interface EducationActionResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly changed: boolean;
  readonly payload?: Record<string, unknown>;
}
