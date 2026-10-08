import { randomUUID } from "node:crypto";
import { loadEducationCatalog } from "./catalog.js";
import type {
  AdmissionApplication,
  EducationActionResult,
  EducationCatalog,
  EducationCommandContext,
  EducationProgram,
  EducationQuestion,
  EducationTermResult,
  EducationTimetableEntry,
  FinalExamAttempt,
  FinalExamRegistration,
  StudentAttendanceRecord,
  StudentEducationRecord,
  StudentSkillRecord,
} from "./types.js";
import type { CharacterRecord } from "../multiplayer/types.js";

const MAX_EDUCATION_EVENTS = 10_000;
const MAX_EDUCATION_ATTENDANCE = 10_000;
const MAX_EDUCATION_ASSESSMENTS = 20_000;
const MAX_EDUCATION_RESULTS = 1_000;
const MAX_EDUCATION_APPLICATIONS = 100;

const validEnrollmentStatuses = new Set(["enrolled", "completed", "left", "transferred"]);
const validProgressionStatuses = new Set([
  "active", "term_result_ready", "eligible_to_promote", "remediation_available",
  "final_exam_eligible", "secondary_complete", "tertiary_active", "tertiary_complete",
  "vocational_active", "left_school",
]);
const validAttendanceStatuses = new Set(["present", "late", "absent", "excused"]);
const validAssessmentSources = new Set(["lesson", "final_exam", "tertiary_course", "teacher_entry"]);

export interface EducationActionOptions {
  readonly programSeatsUsed?: number;
  readonly scholarshipAwardsUsed?: Readonly<Record<string, number>>;
}

type ResolvedEducationTimetableEntry = Omit<EducationTimetableEntry, "subject_id"> & {
  readonly subject_id: string | null;
  readonly subject_name: string | null;
  readonly teacher_name: string | null;
  readonly classroom_name: string | null;
};

function finiteNumber(value: unknown, minimum = -Infinity, maximum = Infinity): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum = 120): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function ids(value: unknown, maximum = 100): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every((item) => boundedString(item, 120));
}

export function isEducationStudentRecord(value: unknown): value is StudentEducationRecord {
  if (!isObject(value)) return false;
  if (
    value.schema_version !== 1 ||
    !boundedString(value.student_id) ||
    !boundedString(value.character_id) ||
    !boundedString(value.school_id) ||
    !boundedString(value.current_class_id, 20) ||
    !finiteNumber(value.academic_year, 1, 100_000) ||
    !finiteNumber(value.term, 1, 12) ||
    !finiteNumber(value.term_start_day, 1, Number.MAX_SAFE_INTEGER) ||
    typeof value.enrollment_status !== "string" ||
    !validEnrollmentStatuses.has(value.enrollment_status) ||
    typeof value.progression_status !== "string" ||
    !validProgressionStatuses.has(value.progression_status) ||
    !ids(value.subject_ids, 32) ||
    !Array.isArray(value.attendance_records) || value.attendance_records.length > MAX_EDUCATION_ATTENDANCE ||
    !Array.isArray(value.assessment_records) || value.assessment_records.length > MAX_EDUCATION_ASSESSMENTS ||
    !Array.isArray(value.term_results) || value.term_results.length > MAX_EDUCATION_RESULTS ||
    !Array.isArray(value.final_exam_registrations) || value.final_exam_registrations.length > 100 ||
    !Array.isArray(value.final_exam_attempts) || value.final_exam_attempts.length > 2_000 ||
    !Array.isArray(value.qualifications) || value.qualifications.length > 500 ||
    !Array.isArray(value.skills) || value.skills.length > 500 ||
    !Array.isArray(value.admission_applications) || value.admission_applications.length > MAX_EDUCATION_APPLICATIONS ||
    (value.tertiary_enrollment !== null && !isObject(value.tertiary_enrollment)) ||
    !Array.isArray(value.vocational_enrollments) || value.vocational_enrollments.length > 100 ||
    !Array.isArray(value.apprenticeships) || value.apprenticeships.length > 100 ||
    !Array.isArray(value.scholarships) || value.scholarships.length > 100 ||
    !Array.isArray(value.education_events) || value.education_events.length > MAX_EDUCATION_EVENTS ||
    !Array.isArray(value.family_support_claims) || value.family_support_claims.length > 1_000
  ) {
    return false;
  }
  if (!value.attendance_records.every((entry) =>
    isObject(entry) && boundedString(entry.attendance_id) &&
    finiteNumber(entry.academic_year, 1) && finiteNumber(entry.term, 1, 12) &&
    finiteNumber(entry.day, 1) && boundedString(entry.schedule_id) &&
    boundedString(entry.class_id, 20) &&
    (entry.subject_id === null || boundedString(entry.subject_id)) &&
    typeof entry.status === "string" && validAttendanceStatuses.has(entry.status) &&
    finiteNumber(entry.minutes_late, 0, 1440) && finiteNumber(entry.recorded_at_minute, 0, 1439))) return false;
  if (!value.assessment_records.every((entry) =>
    isObject(entry) && boundedString(entry.assessment_id) &&
    finiteNumber(entry.academic_year, 1) && finiteNumber(entry.term, 1, 12) &&
    finiteNumber(entry.day, 1) && boundedString(entry.subject_id) &&
    boundedString(entry.assessment_type, 48) && finiteNumber(entry.score, 0, 100) &&
    finiteNumber(entry.maximum_score, 1, 1000) && boundedString(entry.question_id) &&
    typeof entry.source === "string" && validAssessmentSources.has(entry.source))) return false;
  if (!value.term_results.every((entry) =>
    isObject(entry) && boundedString(entry.result_id) &&
    finiteNumber(entry.academic_year, 1) && finiteNumber(entry.term, 1, 12) &&
    finiteNumber(entry.published_day, 1) && finiteNumber(entry.attendance_percent, 0, 100) &&
    finiteNumber(entry.overall_average, 0, 100) && boundedString(entry.overall_grade, 4) &&
    typeof entry.promotion_eligible === "boolean" && Array.isArray(entry.subject_results) &&
    entry.subject_results.every((result) => isObject(result) && boundedString(result.subject_id) &&
      finiteNumber(result.score, 0, 100) && boundedString(result.grade, 4) &&
      boundedString(result.label, 60) && typeof result.passed === "boolean"))) return false;
  if (!value.final_exam_registrations.every((entry) =>
    isObject(entry) && boundedString(entry.registration_id) && boundedString(entry.examination_id) &&
    finiteNumber(entry.registered_day, 1) && ids(entry.subjects, 32) &&
    ["registered", "in_progress", "results_published"].includes(String(entry.status)) &&
    typeof entry.certificate_eligible === "boolean")) return false;
  if (!value.final_exam_attempts.every((entry) =>
    isObject(entry) && boundedString(entry.attempt_id) && boundedString(entry.registration_id) &&
    boundedString(entry.subject_id) && finiteNumber(entry.day, 1) &&
    finiteNumber(entry.score, 0, 100) && boundedString(entry.grade, 4) &&
    typeof entry.credit === "boolean" && boundedString(entry.question_id))) return false;
  if (!value.qualifications.every((entry) =>
    isObject(entry) && boundedString(entry.id) && boundedString(entry.name) &&
    boundedString(entry.award, 60) && boundedString(entry.institution_id) &&
    finiteNumber(entry.completed_day, 1) && ids(entry.career_links, 100))) return false;
  if (!value.skills.every((entry) =>
    isObject(entry) && boundedString(entry.skill_id) && finiteNumber(entry.level, 0, 100) &&
    finiteNumber(entry.experience, 0, 1_000_000) && ids(entry.career_links, 100) &&
    ids(entry.certificate_ids, 500))) return false;
  if (!value.admission_applications.every((entry) =>
    isObject(entry) && boundedString(entry.application_id) && boundedString(entry.program_id) &&
    boundedString(entry.institution_id) && finiteNumber(entry.submitted_day, 1) &&
    ["offered", "declined", "accepted", "rejected", "waitlisted"].includes(String(entry.status)) &&
    typeof entry.decision_reason === "string" && entry.decision_reason.length <= 300)) return false;
  if (value.tertiary_enrollment !== null) {
    const enrollment = value.tertiary_enrollment;
    if (
      !isObject(enrollment) || !boundedString(enrollment.institution_id) ||
      !boundedString(enrollment.program_id) || !boundedString(enrollment.program_kind) ||
      !boundedString(enrollment.award, 60) || !finiteNumber(enrollment.semester, 1, 100) ||
      !finiteNumber(enrollment.duration_semesters, 1, 32) || !finiteNumber(enrollment.semester_start_day, 1) ||
      !["active", "good_standing", "probation", "completed"].includes(String(enrollment.status)) ||
      !ids(enrollment.course_ids, 100) || !isObject(enrollment.course_scores) ||
      !Object.values(enrollment.course_scores).every((scores) => Array.isArray(scores) &&
        scores.length <= 100 && scores.every((score) => finiteNumber(score, 0, 100)))
    ) return false;
  }
  if (!value.vocational_enrollments.every((entry) =>
    isObject(entry) && boundedString(entry.enrollment_id) && boundedString(entry.training_program_id) &&
    boundedString(entry.institution_id) && finiteNumber(entry.started_day, 1) &&
    finiteNumber(entry.sessions_completed, 0, 1_000) && finiteNumber(entry.duration_sessions, 1, 1_000) &&
    ["active", "completed"].includes(String(entry.status)) && boundedString(entry.skill_id))) return false;
  if (!value.apprenticeships.every((entry) =>
    isObject(entry) && boundedString(entry.apprenticeship_id) && boundedString(entry.training_program_id) &&
    boundedString(entry.skill_id) && boundedString(entry.master_teacher_id) &&
    finiteNumber(entry.started_day, 1) && finiteNumber(entry.sessions_completed, 0, 1_000) &&
    finiteNumber(entry.required_sessions, 1, 1_000) && ["active", "completed"].includes(String(entry.status)) &&
    finiteNumber(entry.skill_level, 0, 20))) return false;
  if (!value.scholarships.every((entry) =>
    isObject(entry) && boundedString(entry.scholarship_id) && boundedString(entry.name) &&
    ["merit", "need_based"].includes(String(entry.kind)) && finiteNumber(entry.awarded_day, 1) &&
    finiteNumber(entry.funding_balance_ngn, 0, 1_000_000_000) &&
    finiteNumber(entry.duration_terms, 1, 100) && finiteNumber(entry.remaining_terms, 0, 100) &&
    ["awarded", "exhausted", "expired"].includes(String(entry.status)))) return false;
  if (!value.education_events.every((entry) =>
    isObject(entry) && boundedString(entry.event_id) && boundedString(entry.type, 64) &&
    finiteNumber(entry.day, 1) && finiteNumber(entry.academic_year, 1) && finiteNumber(entry.term, 1, 12) &&
    isObject(entry.details) && Object.values(entry.details).every((detail) =>
      detail === null || typeof detail === "string" || typeof detail === "boolean" || finiteNumber(detail)))) return false;
  return value.family_support_claims.every((entry) =>
    isObject(entry) && finiteNumber(entry.academic_year, 1) && finiteNumber(entry.term, 1, 12) &&
    finiteNumber(entry.amount_ngn, 1, 100_000_000) && finiteNumber(entry.day, 1));
}

function makeId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function appendEvent(
  record: StudentEducationRecord,
  type: string,
  day: number,
  details: Record<string, string | number | boolean | null> = {},
): void {
  record.education_events.push({
    event_id: makeId("education-event"),
    type,
    day,
    academic_year: record.academic_year,
    term: record.term,
    details,
  });
  if (record.education_events.length > MAX_EDUCATION_EVENTS) record.education_events.shift();
}

function curriculumFor(record: StudentEducationRecord, catalog: EducationCatalog): EducationCatalog["curricula"][number] {
  const school = catalog.institutions.find((institution) => institution.id === record.school_id);
  const curriculum = catalog.curricula.find((entry) => entry.id === school?.curriculum_id);
  if (!school || !curriculum) throw new Error("education_catalog_missing_secondary_curriculum");
  return curriculum;
}

function addDiagnosticAssessment(
  record: StudentEducationRecord,
  subjectId: string,
  score: number,
  day: number,
): void {
  if (!record.subject_ids.includes(subjectId) || !finiteNumber(score, 0, 100)) return;
  record.assessment_records.push({
    assessment_id: makeId("assessment"),
    academic_year: record.academic_year,
    term: record.term,
    day,
    subject_id: subjectId,
    assessment_type: "continuous_assessment",
    score,
    maximum_score: 100,
    question_id: "starter-diagnostic",
    source: "teacher_entry",
  });
}

export function createStudentEducationRecord(
  characterId: string,
  age: number,
  day = 1,
  catalog: EducationCatalog = loadEducationCatalog(),
): StudentEducationRecord {
  const school = catalog.institutions.find((institution) => institution.kind === "secondary_school");
  if (!school?.curriculum_id) throw new Error("education_catalog_missing_secondary_school");
  const curriculum = catalog.curricula.find((entry) => entry.id === school.curriculum_id);
  if (!curriculum) throw new Error("education_catalog_missing_curriculum");
  const configuredClass = catalog.calendar.starting_class_by_age[String(age)] ?? "SS1";
  const currentClassId = curriculum.class_ids.includes(configuredClass) ? configuredClass : (curriculum.class_ids[0] ?? "SS1");
  const record: StudentEducationRecord = {
    schema_version: 1,
    student_id: `student-${characterId}`,
    character_id: characterId,
    school_id: school.id,
    current_class_id: currentClassId,
    academic_year: 1,
    term: 1,
    term_start_day: Math.max(1, Math.floor(day)),
    enrollment_status: "enrolled",
    progression_status: "active",
    subject_ids: [...new Set([...curriculum.compulsory_subject_ids, ...curriculum.default_elective_subject_ids])],
    attendance_records: [],
    assessment_records: [],
    term_results: [],
    final_exam_registrations: [],
    final_exam_attempts: [],
    qualifications: [],
    skills: [],
    admission_applications: [],
    tertiary_enrollment: null,
    vocational_enrollments: [],
    apprenticeships: [],
    scholarships: [],
    education_events: [],
    family_support_claims: [],
  };
  for (const [subjectId, score] of Object.entries(catalog.starting_diagnostic_scores)) {
    addDiagnosticAssessment(record, subjectId, score, record.term_start_day);
  }
  appendEvent(record, "student_enrolled", record.term_start_day, {
    school_id: school.id,
    class_id: currentClassId,
    subject_count: record.subject_ids.length,
  });
  return record;
}

export function migrateEducationRecord(
  characterId: string,
  age: number,
  schoolId: string,
  academicScores: Record<string, number>,
  legacyAttendance: readonly Record<string, unknown>[],
  day = 1,
  catalog: EducationCatalog = loadEducationCatalog(),
): StudentEducationRecord {
  const record = createStudentEducationRecord(characterId, age, day, catalog);
  const configuredSchool = catalog.institutions.find((institution) => institution.id === schoolId);
  if (configuredSchool?.kind === "secondary_school") record.school_id = configuredSchool.id;
  for (const subject of catalog.subjects) {
    const legacyScore = academicScores[subject.legacy_score_key] ?? academicScores[subject.name];
    if (finiteNumber(legacyScore, 0, 100)) {
      record.assessment_records = record.assessment_records.filter((entry) => entry.subject_id !== subject.id);
      addDiagnosticAssessment(record, subject.id, legacyScore, record.term_start_day);
    }
  }
  const seen = new Set<string>();
  for (const entry of legacyAttendance.slice(-MAX_EDUCATION_ATTENDANCE)) {
    const subjectName = typeof entry.subject === "string" ? entry.subject : "";
    const subject = catalog.subjects.find((candidate) =>
      candidate.name === subjectName || candidate.legacy_score_key === subjectName);
    const recordDay = finiteNumber(entry.day, 1, Number.MAX_SAFE_INTEGER) ? Math.floor(entry.day) : record.term_start_day;
    const key = `${recordDay}:${subject?.id ?? subjectName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    record.attendance_records.push({
      attendance_id: makeId("attendance"),
      academic_year: record.academic_year,
      term: record.term,
      day: recordDay,
      schedule_id: `legacy-${key}`,
      class_id: record.current_class_id,
      subject_id: subject?.id ?? null,
      status: "present",
      minutes_late: 0,
      recorded_at_minute: 0,
    });
  }
  return record;
}

export function scheduleForStudent(
  record: StudentEducationRecord,
  day: number,
  catalog: EducationCatalog = loadEducationCatalog(),
 ): ResolvedEducationTimetableEntry[] {
  const weekday = ((Math.max(1, Math.floor(day)) - 1) % 7 + 7) % 7;
  const curriculum = curriculumFor(record, catalog);
  return catalog.timetable
    .filter((entry) => entry.days_of_week.includes(weekday) && entry.class_ids.includes(record.current_class_id))
    .map((entry) => {
      let subjectId: string | null = entry.subject_id ?? null;
      if (entry.subject_slot_id) {
        const group = curriculum.elective_groups.find((candidate) => candidate.id === entry.subject_slot_id);
        subjectId = record.subject_ids.find((candidate) => group?.subject_ids.includes(candidate)) ?? null;
      }
      const subjectName = catalog.subjects.find((subject) => subject.id === subjectId)?.name ?? null;
      const teacherName = catalog.teachers.find((teacher) => teacher.id === entry.teacher_id)?.name ?? null;
      const classroomName = catalog.classrooms.find((room) => room.id === entry.classroom_id)?.name ?? null;
      return { ...entry, subject_id: subjectId, subject_name: subjectName, teacher_name: teacherName, classroom_name: classroomName };
    })
    .filter((entry) => entry.kind !== "lesson" || entry.subject_id !== null)
    .sort((left, right) => left.start_minute - right.start_minute);
}

export function nextSchoolLesson(
  record: StudentEducationRecord,
  day: number,
  minuteOfDay: number,
  catalog: EducationCatalog = loadEducationCatalog(),
): ReturnType<typeof scheduleForStudent>[number] | null {
  const attendanceKeys = new Set(record.attendance_records.map((entry) => `${entry.day}:${entry.schedule_id}`));
  const earlyWindow = 30;
  const grace = catalog.calendar.late_grace_minutes;
  return scheduleForStudent(record, day, catalog).find((entry) =>
    entry.kind === "lesson" &&
    !attendanceKeys.has(`${day}:${entry.id}`) &&
    minuteOfDay >= entry.start_minute - earlyWindow &&
    minuteOfDay <= entry.start_minute + grace) ?? null;
}

function alreadyRecorded(
  record: StudentEducationRecord,
  scheduleId: string,
  day: number,
): boolean {
  return record.attendance_records.some((entry) => entry.schedule_id === scheduleId && entry.day === day);
}

export function recordSchoolAttendance(
  record: StudentEducationRecord,
  entry: {
    readonly id: string;
    readonly start_minute: number;
    readonly subject_id?: string | null;
    readonly class_id?: string;
  },
  day: number,
  minuteOfDay: number,
  statusOverride?: StudentAttendanceRecord["status"],
  catalog: EducationCatalog = loadEducationCatalog(),
): StudentAttendanceRecord {
  const existing = record.attendance_records.find((attendance) =>
    attendance.schedule_id === entry.id && attendance.day === day);
  if (existing) return existing;
  const lateness = Math.max(0, minuteOfDay - entry.start_minute);
  const status = statusOverride ?? (lateness > catalog.calendar.late_grace_minutes ? "late" : "present");
  const attendance: StudentAttendanceRecord = {
    attendance_id: makeId("attendance"),
    academic_year: record.academic_year,
    term: record.term,
    day,
    schedule_id: entry.id,
    class_id: entry.class_id ?? record.current_class_id,
    subject_id: entry.subject_id ?? null,
    status,
    minutes_late: status === "late" ? lateness : 0,
    recorded_at_minute: Math.max(0, Math.min(1439, Math.floor(minuteOfDay))),
  };
  record.attendance_records.push(attendance);
  if (record.attendance_records.length > MAX_EDUCATION_ATTENDANCE) record.attendance_records.shift();
  appendEvent(record, status === "absent" ? "class_absence_recorded" : "class_attendance_recorded", day, {
    schedule_id: entry.id,
    subject_id: attendance.subject_id,
    status,
  });
  return attendance;
}

export function markMissedSchoolPeriods(
  record: StudentEducationRecord,
  day: number,
  minuteOfDay: number,
  catalog: EducationCatalog = loadEducationCatalog(),
): number {
  if (record.enrollment_status !== "enrolled" || !catalog.calendar.school_days_of_week.includes((day - 1) % 7)) return 0;
  let marked = 0;
  for (const entry of scheduleForStudent(record, day, catalog)) {
    if (entry.kind === "break" || alreadyRecorded(record, entry.id, day)) continue;
    if (minuteOfDay > entry.start_minute + entry.duration_minutes + catalog.calendar.late_grace_minutes) {
      recordSchoolAttendance(record, entry, day, minuteOfDay, "absent", catalog);
      marked += 1;
    }
  }
  return marked;
}

function advanceScholarshipTerm(record: StudentEducationRecord, day: number): void {
  for (const award of record.scholarships) {
    if (award.status !== "awarded") continue;
    award.remaining_terms = Math.max(0, award.remaining_terms - 1);
    if (award.remaining_terms === 0) {
      award.status = "expired";
      award.funding_balance_ngn = 0;
      appendEvent(record, "scholarship_period_expired", day, { scholarship_id: award.scholarship_id });
    }
  }
}

function currentTermAttendancePercent(record: StudentEducationRecord): number {
  const entries = record.attendance_records.filter((entry) =>
    entry.academic_year === record.academic_year && entry.term === record.term && entry.status !== "excused");
  if (entries.length === 0) return 0;
  const attended = entries.filter((entry) => entry.status === "present" || entry.status === "late").length;
  return Math.round((attended / entries.length) * 100);
}

function scoreForSubject(
  record: StudentEducationRecord,
  subjectId: string,
  catalog: EducationCatalog,
): number {
  const entries = record.assessment_records.filter((entry) =>
    entry.academic_year === record.academic_year && entry.term === record.term && entry.subject_id === subjectId);
  const weights = catalog.grading.assessment_weights;
  const totals = new Map<string, { sum: number; count: number }>();
  for (const entry of entries) {
    const bucket = totals.get(entry.assessment_type) ?? { sum: 0, count: 0 };
    bucket.sum += (entry.score / entry.maximum_score) * 100;
    bucket.count += 1;
    totals.set(entry.assessment_type, bucket);
  }
  const activeWeights = [...totals.entries()].map(([type, value]) => ({
    weight: weights[type] ?? 0,
    average: value.sum / value.count,
  })).filter((entry) => entry.weight > 0);
  let academicScore: number;
  if (activeWeights.length > 0) {
    const totalWeight = activeWeights.reduce((sum, entry) => sum + entry.weight, 0);
    academicScore = activeWeights.reduce((sum, entry) => sum + entry.average * entry.weight, 0) / totalWeight;
  } else {
    const historic = record.assessment_records.filter((entry) => entry.subject_id === subjectId);
    academicScore = historic.length > 0
      ? historic.reduce((sum, entry) => sum + entry.score / entry.maximum_score * 100, 0) / historic.length
      : 0;
  }
  const attendance = currentTermAttendancePercent(record);
  const attendanceWeight = catalog.grading.attendance_weight;
  return Math.round(Math.max(0, Math.min(100, academicScore * (1 - attendanceWeight) + attendance * attendanceWeight)));
}

function gradeForScore(score: number, catalog: EducationCatalog): { grade: string; label: string } {
  const band = [...catalog.grading.grade_bands]
    .sort((left, right) => right.minimum_score - left.minimum_score)
    .find((candidate) => score >= candidate.minimum_score);
  return band ? { grade: band.grade, label: band.label } : { grade: "F", label: "Needs support" };
}

function currentReportAverage(record: StudentEducationRecord, catalog: EducationCatalog): number {
  const latest = [...record.term_results].sort((left, right) =>
    right.academic_year - left.academic_year || right.term - left.term)[0];
  if (latest) return latest.overall_average;
  const scores = record.subject_ids.map((subjectId) => scoreForSubject(record, subjectId, catalog));
  return scores.length > 0 ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
}

export function closeCurrentTerm(
  record: StudentEducationRecord,
  day: number,
  catalog: EducationCatalog = loadEducationCatalog(),
): EducationTermResult {
  if (record.enrollment_status !== "enrolled" || record.progression_status !== "active") {
    throw new Error("education_term_not_active");
  }
  if (day < record.term_start_day + catalog.calendar.term_length_game_days) {
    throw new Error("education_term_not_due");
  }
  if (record.term_results.some((entry) =>
    entry.academic_year === record.academic_year && entry.term === record.term)) {
    throw new Error("education_term_already_closed");
  }
  const dueDay = day - 1;
  for (let missedDay = record.term_start_day; missedDay <= dueDay; missedDay += 1) {
    markMissedSchoolPeriods(record, missedDay, 1439, catalog);
  }
  const attendancePercent = currentTermAttendancePercent(record);
  const curriculum = curriculumFor(record, catalog);
  const subjectResults = record.subject_ids.map((subjectId) => {
    const score = scoreForSubject(record, subjectId, catalog);
    const grade = gradeForScore(score, catalog);
    return {
      subject_id: subjectId,
      score,
      grade: grade.grade,
      label: grade.label,
      passed: score >= catalog.grading.pass_score,
    };
  });
  const overallAverage = subjectResults.length > 0
    ? Math.round(subjectResults.reduce((sum, result) => sum + result.score, 0) / subjectResults.length)
    : 0;
  const coreResults = subjectResults.filter((result) => curriculum.compulsory_subject_ids.includes(result.subject_id));
  const promotionEligible = overallAverage >= catalog.grading.promotion_minimum_average &&
    coreResults.every((result) => result.score >= catalog.grading.core_subject_minimum_score);
  const overallGrade = gradeForScore(overallAverage, catalog);
  const result: EducationTermResult = {
    result_id: makeId("term-result"),
    academic_year: record.academic_year,
    term: record.term,
    published_day: day,
    attendance_percent: attendancePercent,
    overall_average: overallAverage,
    overall_grade: overallGrade.grade,
    promotion_eligible: promotionEligible,
    subject_results: subjectResults,
  };
  record.term_results.push(result);
  if (record.term_results.length > MAX_EDUCATION_RESULTS) record.term_results.shift();
  appendEvent(record, "term_result_published", day, {
    result_id: result.result_id,
    overall_average: overallAverage,
    attendance_percent: attendancePercent,
    promotion_eligible: promotionEligible,
  });
  advanceScholarshipTerm(record, day);
  if (record.term >= catalog.calendar.terms_per_academic_year) {
    record.progression_status = promotionEligible ? "eligible_to_promote" : "remediation_available";
  } else {
    record.term += 1;
    record.term_start_day = day;
    record.progression_status = "active";
  }
  return result;
}

export function resolveSecondaryProgression(
  record: StudentEducationRecord,
  choice: unknown,
  day: number,
  catalog: EducationCatalog = loadEducationCatalog(),
): string {
  if (record.term !== catalog.calendar.terms_per_academic_year ||
    (record.progression_status !== "eligible_to_promote" && record.progression_status !== "remediation_available")) {
    throw new Error("education_progression_not_available");
  }
  if (choice === "leave") {
    record.enrollment_status = "left";
    record.progression_status = "left_school";
    appendEvent(record, "secondary_school_left", day, { class_id: record.current_class_id });
    return "You left secondary school with your education history preserved. Vocational and apprenticeship paths remain open.";
  }
  if (choice === "repeat" || choice === "remediate") {
    record.academic_year += 1;
    record.term = 1;
    record.term_start_day = day;
    record.progression_status = "active";
    appendEvent(record, choice === "repeat" ? "class_repeated" : "remedial_year_started", day, {
      class_id: record.current_class_id,
      next_academic_year: record.academic_year,
    });
    return choice === "repeat"
      ? `You will repeat ${record.current_class_id}. Previous results remain in your record.`
      : `A supported recovery year begins in ${record.current_class_id}; this is a fresh chance, not a permanent failure.`;
  }
  if (choice !== "promote" || record.progression_status !== "eligible_to_promote") {
    throw new Error("education_progression_choice_unavailable");
  }
  const currentYear = catalog.school_years.find((entry) => entry.id === record.current_class_id);
  if (!currentYear) throw new Error("education_class_unavailable");
  const nextClass = currentYear.next_class_id;
  if (nextClass === null) {
    record.progression_status = "final_exam_eligible";
    appendEvent(record, "secondary_school_completed", day, { class_id: record.current_class_id });
    return "You completed SS 3 and may register for the fictional senior certificate examination.";
  }
  record.current_class_id = nextClass;
  record.academic_year += 1;
  record.term = 1;
  record.term_start_day = day;
  const curriculum = curriculumFor(record, catalog);
  record.subject_ids = [...new Set([...curriculum.compulsory_subject_ids, ...curriculum.default_elective_subject_ids])];
  record.progression_status = "active";
  appendEvent(record, "class_promoted", day, { class_id: nextClass, academic_year: record.academic_year });
  return `You progressed to ${catalog.school_years.find((entry) => entry.id === nextClass)?.label ?? nextClass}.`;
}

function validCurrentExamRegistration(record: StudentEducationRecord): FinalExamRegistration | null {
  return [...record.final_exam_registrations].reverse().find((entry) => entry.status !== "results_published") ?? null;
}

export function registerFinalExamination(
  record: StudentEducationRecord,
  selectedSubjects: readonly string[],
  day: number,
  catalog: EducationCatalog = loadEducationCatalog(),
): FinalExamRegistration {
  if (record.progression_status !== "final_exam_eligible" || record.current_class_id !== "SS3") {
    throw new Error("education_final_exam_not_eligible");
  }
  if (validCurrentExamRegistration(record)) throw new Error("education_final_exam_already_registered");
  const uniqueSubjects = [...new Set(selectedSubjects)];
  const exam = catalog.final_examination;
  if (
    uniqueSubjects.length < exam.minimum_subjects ||
    uniqueSubjects.length > record.subject_ids.length ||
    !uniqueSubjects.every((subjectId) => record.subject_ids.includes(subjectId)) ||
    !exam.required_credit_subject_ids.every((subjectId) => uniqueSubjects.includes(subjectId))
  ) {
    throw new Error("education_final_exam_subjects_invalid");
  }
  const registration: FinalExamRegistration = {
    registration_id: makeId("final-registration"),
    examination_id: exam.id,
    registered_day: day,
    subjects: uniqueSubjects,
    status: "registered",
    certificate_eligible: false,
  };
  record.final_exam_registrations.push(registration);
  appendEvent(record, "final_exam_registered", day, {
    registration_id: registration.registration_id,
    subject_count: uniqueSubjects.length,
  });
  return registration;
}

export function nextFinalExamQuestion(
  record: StudentEducationRecord,
  day: number,
  catalog: EducationCatalog = loadEducationCatalog(),
): { registration: FinalExamRegistration; subject_id: string; question: EducationQuestion } | null {
  const registration = validCurrentExamRegistration(record);
  if (!registration || day < registration.registered_day + catalog.final_examination.exam_days_after_registration) return null;
  for (const subjectId of registration.subjects) {
    if (record.final_exam_attempts.some((attempt) =>
      attempt.registration_id === registration.registration_id && attempt.subject_id === subjectId)) continue;
    const question = catalog.questions.find((entry) =>
      entry.subject_id === subjectId && entry.class_ids.includes("SS3"));
    if (question) return { registration, subject_id: subjectId, question };
  }
  return null;
}

function maybePublishFinalResults(
  record: StudentEducationRecord,
  registration: FinalExamRegistration,
  day: number,
  catalog: EducationCatalog,
): boolean {
  const attempts = record.final_exam_attempts.filter((attempt) => attempt.registration_id === registration.registration_id);
  if (!registration.subjects.every((subjectId) => attempts.some((attempt) => attempt.subject_id === subjectId))) return false;
  const credits = attempts.filter((attempt) => attempt.credit);
  const requiredCredits = catalog.final_examination.required_credit_subject_ids.every((subjectId) =>
    credits.some((attempt) => attempt.subject_id === subjectId));
  const eligible = credits.length >= catalog.final_examination.minimum_credits && requiredCredits;
  const registrationIndex = record.final_exam_registrations.findIndex((entry) =>
    entry.registration_id === registration.registration_id);
  if (registrationIndex >= 0) {
    record.final_exam_registrations[registrationIndex] = {
      ...registration,
      status: "results_published",
      certificate_eligible: eligible,
    };
  }
  if (eligible && !record.qualifications.some((qualification) => qualification.id === "qualification:secondary-school-certificate")) {
    const secondarySchool = catalog.institutions.find((institution) => institution.kind === "secondary_school");
    record.qualifications.push({
      id: "qualification:secondary-school-certificate",
      name: "Senior secondary completion certificate",
      award: "Secondary certificate (fictional game award)",
      institution_id: secondarySchool?.id ?? record.school_id,
      completed_day: day,
      career_links: [],
    });
    record.progression_status = "secondary_complete";
    record.enrollment_status = "completed";
  }
  appendEvent(record, "final_exam_results_published", day, {
    registration_id: registration.registration_id,
    credits: credits.length,
    certificate_eligible: eligible,
  });
  return eligible;
}

export function recordFinalExamAnswer(
  record: StudentEducationRecord,
  registrationId: string,
  subjectId: string,
  questionId: string,
  answerIndex: number,
  day: number,
  catalog: EducationCatalog = loadEducationCatalog(),
): { attempt: FinalExamAttempt; certificate_eligible: boolean | null } {
  const registration = record.final_exam_registrations.find((entry) =>
    entry.registration_id === registrationId && entry.status !== "results_published");
  const question = catalog.questions.find((entry) => entry.id === questionId && entry.subject_id === subjectId);
  if (!registration || !registration.subjects.includes(subjectId) || !question ||
    !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= question.choices.length ||
    record.final_exam_attempts.some((attempt) => attempt.registration_id === registrationId && attempt.subject_id === subjectId)) {
    throw new Error("education_final_exam_answer_invalid");
  }
  const score = answerIndex === question.correct_choice_index ? 100 : 0;
  const grade = gradeForScore(score, catalog).grade;
  const attempt: FinalExamAttempt = {
    attempt_id: makeId("final-attempt"),
    registration_id: registrationId,
    subject_id: subjectId,
    day,
    score,
    grade,
    credit: score >= catalog.final_examination.pass_score,
    question_id: questionId,
  };
  record.final_exam_attempts.push(attempt);
  record.assessment_records.push({
    assessment_id: makeId("assessment"),
    academic_year: record.academic_year,
    term: record.term,
    day,
    subject_id: subjectId,
    assessment_type: "examination",
    score,
    maximum_score: 100,
    question_id: questionId,
    source: "final_exam",
  });
  const registrationIndex = record.final_exam_registrations.findIndex((entry) => entry.registration_id === registrationId);
  if (registrationIndex >= 0) record.final_exam_registrations[registrationIndex] = { ...registration, status: "in_progress" };
  const certificateEligible = maybePublishFinalResults(record, registration, day, catalog);
  appendEvent(record, "final_exam_attempt_recorded", day, {
    subject_id: subjectId,
    score,
    credit: attempt.credit,
    registration_id: registrationId,
  });
  return { attempt, certificate_eligible: certificateEligible ? true : null };
}

function latestFinalExamCredits(record: StudentEducationRecord): Set<string> {
  const registration = [...record.final_exam_registrations].reverse().find((entry) => entry.status === "results_published");
  if (!registration) return new Set();
  return new Set(record.final_exam_attempts
    .filter((attempt) => attempt.registration_id === registration.registration_id && attempt.credit)
    .map((attempt) => attempt.subject_id));
}

function eligibilityForProgram(
  character: CharacterRecord,
  program: EducationProgram,
  record: StudentEducationRecord,
  catalog: EducationCatalog,
): string | null {
  if (character.age < program.minimum_age) return `This program currently requires age ${program.minimum_age}.`;
  const credits = latestFinalExamCredits(record);
  if (credits.size < program.requirements.minimum_final_credits) return "Complete enough senior-exam credits first.";
  if (!program.requirements.required_subject_ids.every((subjectId) => credits.has(subjectId))) {
    return "Required subject credits are missing.";
  }
  if (currentReportAverage(record, catalog) < program.requirements.minimum_secondary_average) {
    return "Your latest academic average is below this program's prototype entry requirement.";
  }
  if (!(program.requirements.required_qualification_ids ?? []).every((qualificationId) =>
    record.qualifications.some((qualification) => qualification.id === qualificationId))) {
    return "A prerequisite qualification is missing.";
  }
  return null;
}

function chargeEducationCost(
  character: CharacterRecord,
  amount: number,
): boolean {
  if (!Number.isSafeInteger(amount) || amount < 0) return false;
  const scholarshipFunds = character.education_record.scholarships;
  const availableScholarship = scholarshipFunds.reduce((sum, award) =>
    sum + (award.status === "awarded" ? award.funding_balance_ngn : 0), 0);
  if (character.money + availableScholarship < amount) return false;
  let remainder = amount;
  for (const award of scholarshipFunds) {
    if (award.status !== "awarded" || remainder <= 0) continue;
    const used = Math.min(remainder, award.funding_balance_ngn);
    award.funding_balance_ngn -= used;
    remainder -= used;
    if (award.funding_balance_ngn === 0) award.status = "exhausted";
  }
  character.money -= remainder;
  return true;
}

function addSkillExperience(
  record: StudentEducationRecord,
  skillId: string,
  experience: number,
  careerLinks: readonly string[],
  certificateId?: string,
): StudentSkillRecord {
  let skill = record.skills.find((entry) => entry.skill_id === skillId);
  if (!skill) {
    skill = { skill_id: skillId, level: 0, experience: 0, career_links: [...careerLinks], certificate_ids: [] };
    record.skills.push(skill);
  }
  skill.experience += experience;
  skill.level = Math.min(100, Math.max(skill.level, Math.floor(skill.experience / 100)));
  if (certificateId && !skill.certificate_ids.includes(certificateId)) skill.certificate_ids.push(certificateId);
  return skill;
}

export function applyEducationAction(
  character: CharacterRecord,
  action: string,
  payload: Record<string, unknown>,
  context: EducationCommandContext,
  options: EducationActionOptions = {},
  catalog: EducationCatalog = loadEducationCatalog(),
): EducationActionResult {
  const record = character.education_record;
  const success = (code: string, message: string, data?: Record<string, unknown>): EducationActionResult => ({
    ok: true,
    code,
    message,
    changed: true,
    ...(data === undefined ? {} : { payload: data }),
  });
  const failure = (code: string, message: string): EducationActionResult => ({
    ok: false, code, message, changed: false,
  });

  try {
    switch (action) {
      case "choose_subjects": {
        const selection = validateStudentSubjectChoices(record, ids(payload.subject_ids, 32) ? payload.subject_ids : [], catalog);
        if (!selection.ok) return failure("education_subjects_invalid", selection.message);
        appendEvent(record, "subject_choices_updated", context.day, { subject_count: selection.subject_ids.length });
        syncLegacyEducation(character, catalog);
        return success("education_subjects_updated", selection.message, { subject_ids: selection.subject_ids });
      }
      case "choose_elective": {
        const subjectId = typeof payload.subject_id === "string" ? payload.subject_id : "";
        const curriculum = curriculumFor(record, catalog);
        const group = curriculum.elective_groups.find((entry) => entry.subject_ids.includes(subjectId));
        if (!group) return failure("education_elective_unavailable", "That subject is not part of a configured elective group.");
        const selectedInGroup = record.subject_ids.filter((selected) => group.subject_ids.includes(selected));
        if (selectedInGroup.includes(subjectId)) return failure("education_elective_selected", "That subject is already selected.");
        const nextSubjects = record.subject_ids.filter((selected) => !selectedInGroup.includes(selected));
        if (selectedInGroup.length >= group.maximum_choices) selectedInGroup.pop();
        nextSubjects.push(...selectedInGroup, subjectId);
        const selection = validateStudentSubjectChoices(record, nextSubjects, catalog);
        if (!selection.ok) return failure("education_subjects_invalid", selection.message);
        appendEvent(record, "elective_subject_selected", context.day, { subject_id: subjectId, group_id: group.id });
        syncLegacyEducation(character, catalog);
        return success("education_subjects_updated", `You selected ${catalog.subjects.find((subject) => subject.id === subjectId)?.name ?? subjectId} as an optional subject.`, { subject_ids: selection.subject_ids });
      }
      case "close_term": {
        const result = closeCurrentTerm(record, context.day, catalog);
        character.academic_scores = legacyAcademicScores(record, catalog);
        character.attendance = legacyAttendanceRecords(record, catalog);
        return success("education_term_published", `Term result published: ${result.overall_grade} · ${result.overall_average}% overall · ${result.attendance_percent}% attendance.`, { result });
      }
      case "choose_progression": {
        const message = resolveSecondaryProgression(record, payload.choice, context.day, catalog);
        syncLegacyEducation(character, catalog);
        return success("education_progression_updated", message);
      }
      case "pay_school_fees": {
        const school = catalog.institutions.find((institution) => institution.id === record.school_id);
        if (!school) return failure("education_school_unavailable", "The configured school record is missing.");
        const feeEventType = `school_fees_paid:${record.academic_year}:${record.term}`;
        if (record.education_events.some((event) => event.type === feeEventType)) {
          return failure("education_fees_already_paid", "School fees for this term are already recorded as paid.");
        }
        const tuition = Math.ceil((school.annual_fee_ngn ?? 0) / catalog.calendar.terms_per_academic_year);
        const materials = record.academic_year === 1 && record.term === 1
          ? catalog.education_costs.books_and_materials_ngn
          : 0;
        const amount = tuition + materials;
        if (!chargeEducationCost(character, amount)) return failure("insufficient_funds", `This term's configured school and materials cost is ₦${amount}.`);
        appendEvent(record, feeEventType, context.day, { amount_ngn: amount, school_id: school.id });
        syncLegacyEducation(character, catalog);
        return success("education_fees_paid", `You paid ₦${amount} toward the configured school term and materials.`);
      }
      case "register_final_exam": {
        const selectedSubjects = ids(payload.subject_ids, 32) ? payload.subject_ids : [];
        const currentRegistration = validCurrentExamRegistration(record);
        const fee = currentRegistration ? catalog.final_examination.retake_fee_ngn : catalog.final_examination.registration_fee_ngn;
        if (selectedSubjects.length < catalog.final_examination.minimum_subjects ||
          !selectedSubjects.every((subjectId) => record.subject_ids.includes(subjectId))) {
          return failure("education_final_exam_subjects_invalid", "Choose at least the configured minimum number of subjects from your current course list.");
        }
        if (!chargeEducationCost(character, fee)) return failure("insufficient_funds", `Registration costs ₦${fee}; request family support or a scholarship if eligible.`);
        const registration = registerFinalExamination(record, selectedSubjects, context.day, catalog);
        syncLegacyEducation(character, catalog);
        return success("education_final_exam_registered", `${catalog.final_examination.name} registration is saved. Papers open on the next game day.`, { registration });
      }
      case "begin_final_exam": {
        const next = nextFinalExamQuestion(record, context.day, catalog);
        if (!next) return failure("education_final_exam_not_ready", "There is no available final-exam paper today. Check your registration and timetable.");
        return {
          ok: true,
          code: "education_exam_started",
          message: `${catalog.final_examination.name} · ${catalog.subjects.find((subject) => subject.id === next.subject_id)?.name ?? next.subject_id}`,
          changed: false,
          payload: { registration_id: next.registration.registration_id, subject_id: next.subject_id, question: publicQuestion(next.question) },
        };
      }
      case "apply_program": {
        const programId = payload.program_id;
        const program = typeof programId === "string" ? catalog.programs.find((entry) => entry.id === programId) : undefined;
        if (!program) return failure("education_program_unavailable", "That education program is not available.");
        if (record.admission_applications.length >= MAX_EDUCATION_APPLICATIONS) return failure("education_application_limit", "The prototype education record has reached its application limit.");
        if (record.admission_applications.some((application) => application.program_id === program.id &&
          (application.status === "offered" || application.status === "accepted"))) {
          return failure("education_application_exists", "You already have an active offer or enrollment application for this program.");
        }
        const institution = catalog.institutions.find((entry) => entry.id === program.institution_id);
        if (!institution) return failure("education_institution_unavailable", "The institution record is missing.");
        const applicationFee = program.application_fee_ngn;
        if (!chargeEducationCost(character, applicationFee)) return failure("insufficient_funds", `The application fee is ₦${applicationFee}. Ask family for support or check scholarships.`);
        const eligibility = eligibilityForProgram(character, program, record, catalog);
        const seatsUsed = options.programSeatsUsed ?? 0;
        const status: AdmissionApplication["status"] = eligibility
          ? "rejected"
          : seatsUsed >= program.capacity ? "waitlisted" : "offered";
        const reason = eligibility ?? (status === "waitlisted" ? "The prototype program is currently at capacity." : "Entry checks passed; accept or decline this offer.");
        const application: AdmissionApplication = {
          application_id: makeId("application"),
          program_id: program.id,
          institution_id: institution.id,
          submitted_day: context.day,
          status,
          decision_reason: reason,
        };
        record.admission_applications.push(application);
        appendEvent(record, "admission_application_decided", context.day, {
          application_id: application.application_id,
          program_id: program.id,
          status,
        });
        return success("education_application_decided", status === "offered"
          ? `${institution.name} has offered you a place on ${program.name}. Accept or decline in your education record.`
          : status === "waitlisted" ? "Your application is waitlisted because the prototype intake is full." : `Your application was not accepted: ${reason}`, { application });
      }
      case "respond_application": {
        const applicationId = payload.application_id;
        const decision = payload.decision ?? (payload.accept === true ? "accept" : payload.accept === false ? "decline" : null);
        const application = typeof applicationId === "string"
          ? record.admission_applications.find((entry) => entry.application_id === applicationId)
          : undefined;
        if (!application || application.status !== "offered" || (decision !== "accept" && decision !== "decline")) {
          return failure("education_offer_unavailable", "That admission offer is not available.");
        }
        if (decision === "decline") {
          application.status = "declined";
          appendEvent(record, "admission_offer_declined", context.day, { program_id: application.program_id });
          return success("education_offer_declined", "You declined the offer. Other programs and vocational routes remain available.");
        }
        const program = catalog.programs.find((entry) => entry.id === application.program_id);
        if (!program) return failure("education_program_unavailable", "The offered program is no longer available.");
        const totalDue = program.registration_fee_ngn + program.tuition_per_term_ngn;
        if (!chargeEducationCost(character, totalDue)) return failure("insufficient_funds", `Enrollment requires ₦${totalDue} for registration and the first term. Apply for a scholarship, request family support or choose a lower-cost route.`);
        application.status = "accepted";
        record.tertiary_enrollment = {
          institution_id: program.institution_id,
          program_id: program.id,
          program_kind: program.kind,
          award: program.award,
          semester: 1,
          duration_semesters: program.duration_semesters,
          semester_start_day: context.day,
          status: "active",
          course_ids: [...program.course_ids],
          course_scores: {},
        };
        record.progression_status = "tertiary_active";
        record.enrollment_status = "enrolled";
        appendEvent(record, "tertiary_enrollment_started", context.day, {
          institution_id: program.institution_id,
          program_id: program.id,
          award: program.award,
        });
        syncLegacyEducation(character, catalog);
        return success("education_enrolled", `You enrolled in ${program.name} (${program.award}). Your current balance is ₦${character.money}.`);
      }
      case "close_tertiary_semester": {
        const enrollment = record.tertiary_enrollment;
        const program = activeProgram(record, catalog);
        if (!enrollment || !program || enrollment.status === "completed") return failure("education_not_enrolled", "There is no active tertiary program to close.");
        if (context.day < enrollment.semester_start_day + catalog.tertiary_calendar.term_length_game_days) return failure("education_semester_not_due", "The semester period is still in progress.");
        const courseResults = enrollment.course_ids.map((courseId) => enrollment.course_scores[courseId] ?? []);
        if (courseResults.some((scores) => scores.length < enrollment.semester)) {
          return failure("education_course_results_incomplete", "Complete an assessment in every program course before closing the semester.");
        }
        const currentSemesterScores = courseResults.map((scores) => scores[enrollment.semester - 1] ?? 0);
        const average = currentSemesterScores.length > 0
          ? Math.round(currentSemesterScores.reduce((sum, score) => sum + score, 0) / currentSemesterScores.length)
          : 0;
        if (average < catalog.tertiary_calendar.good_standing_average) {
          if (!chargeEducationCost(character, program.tuition_per_term_ngn)) {
            return failure("insufficient_funds", `Repeating this semester requires ₦${program.tuition_per_term_ngn}. Apply for education funding or family support.`);
          }
          for (const courseId of enrollment.course_ids) {
            enrollment.course_scores[courseId] = (enrollment.course_scores[courseId] ?? []).slice(0, enrollment.semester - 1);
          }
          enrollment.status = "probation";
          enrollment.semester_start_day = context.day;
          appendEvent(record, "tertiary_academic_warning", context.day, { semester: enrollment.semester, average });
          advanceScholarshipTerm(record, context.day);
          return success("education_academic_warning", `Academic warning: ${average}% is below the configured progression threshold. The repeat-semester tuition was paid.`);
        }
        if (enrollment.semester < enrollment.duration_semesters) {
          if (!chargeEducationCost(character, program.tuition_per_term_ngn)) {
            return failure("insufficient_funds", `The next semester requires ₦${program.tuition_per_term_ngn}. Apply for education funding or family support.`);
          }
          enrollment.status = "good_standing";
          enrollment.semester += 1;
          enrollment.semester_start_day = context.day;
          enrollment.status = "active";
          appendEvent(record, "tertiary_semester_completed", context.day, { completed_semester: enrollment.semester - 1, average });
          advanceScholarshipTerm(record, context.day);
          return success("education_semester_advanced", `Semester ${enrollment.semester} is now open. Overall course average: ${average}%.`);
        }
        enrollment.status = "completed";
        advanceScholarshipTerm(record, context.day);
        record.progression_status = "tertiary_complete";
        const qualificationId = `qualification:${program.id}`;
        if (!record.qualifications.some((qualification) => qualification.id === qualificationId)) {
          const institution = catalog.institutions.find((entry) => entry.id === program.institution_id);
          record.qualifications.push({
            id: qualificationId,
            name: program.name,
            award: program.award,
            institution_id: institution?.id ?? program.institution_id,
            completed_day: context.day,
            career_links: [...program.career_links],
          });
        }
        appendEvent(record, "tertiary_qualification_awarded", context.day, { program_id: program.id, award: program.award, average });
        syncLegacyEducation(character, catalog);
        return success("education_program_completed", `You completed ${program.name} and earned ${program.award}. Future career eligibility links are recorded; no employment system has been added.`);
      }
      case "enroll_training":
      case "enroll_apprenticeship": {
        const trainingProgramId = payload.training_program_id;
        const training = typeof trainingProgramId === "string"
          ? catalog.training_programs.find((entry) => entry.id === trainingProgramId)
          : undefined;
        if (!training) return failure("education_training_unavailable", "That training program is not available.");
        if (record.vocational_enrollments.some((entry) => entry.status === "active") ||
          record.apprenticeships.some((entry) => entry.status === "active")) {
          return failure("education_training_already_active", "Complete or leave your current training before starting another.");
        }
        if (action === "enroll_training") {
          const enrollment = {
            enrollment_id: makeId("vocational-enrollment"),
            training_program_id: training.id,
            institution_id: training.institution_id,
            started_day: context.day,
            sessions_completed: 0,
            duration_sessions: training.duration_sessions,
            status: "active" as const,
            skill_id: training.skill_id,
          };
          record.vocational_enrollments.push(enrollment);
          record.progression_status = "vocational_active";
          appendEvent(record, "vocational_training_started", context.day, { training_program_id: training.id, skill_id: training.skill_id });
          return success("education_training_enrolled", `You enrolled in ${training.name}. Attend the community skills centre to practise; each session costs ₦${training.session_cost_ngn}.`, { enrollment });
        }
        const apprenticeship = {
          apprenticeship_id: makeId("apprenticeship"),
          training_program_id: training.id,
          skill_id: training.skill_id,
          master_teacher_id: training.master_teacher_id,
          started_day: context.day,
          sessions_completed: 0,
          required_sessions: Math.max(catalog.apprenticeship_defaults.minimum_sessions, training.duration_sessions),
          status: "active" as const,
          skill_level: 0,
        };
        record.apprenticeships.push(apprenticeship);
        record.progression_status = "vocational_active";
        appendEvent(record, "apprenticeship_started", context.day, { training_program_id: training.id, master_teacher_id: training.master_teacher_id });
        return success("education_apprenticeship_started", `You began ${training.name} with a named mentor. Practice sessions build a skill record and completion certificate.`, { apprenticeship });
      }
      case "practice_training": {
        if (context.currentLocation !== "training_center") return failure("education_training_location_required", "Travel to the community skills centre before practising.");
        const enrollment = record.vocational_enrollments.find((entry) => entry.status === "active");
        const apprenticeship = record.apprenticeships.find((entry) => entry.status === "active");
        if (!enrollment && !apprenticeship) return failure("education_training_not_enrolled", "Choose a vocational course or apprenticeship first.");
        const trainingId = enrollment?.training_program_id ?? apprenticeship?.training_program_id;
        const training = catalog.training_programs.find((entry) => entry.id === trainingId);
        if (!training) return failure("education_training_unavailable", "The training catalog entry is missing.");
        if (!chargeEducationCost(character, training.session_cost_ngn)) return failure("insufficient_funds", `This practical session costs ₦${training.session_cost_ngn}. Request support or choose another route.`);
        character.energy = Math.max(0, character.energy - 2);
        const required = apprenticeship?.required_sessions ?? enrollment?.duration_sessions ?? training.duration_sessions;
        const nextSessions = (apprenticeship?.sessions_completed ?? enrollment?.sessions_completed ?? 0) + 1;
        if (enrollment) enrollment.sessions_completed = nextSessions;
        if (apprenticeship) {
          apprenticeship.sessions_completed = nextSessions;
          apprenticeship.skill_level = Math.min(catalog.apprenticeship_defaults.completion_skill_level, nextSessions / required);
        }
        const complete = nextSessions >= required;
        const certificateId = complete ? `certificate:${training.id}` : undefined;
        const skill = addSkillExperience(record, training.skill_id, 25, training.career_links, certificateId);
        if (complete) {
          if (enrollment) enrollment.status = "completed";
          if (apprenticeship) apprenticeship.status = "completed";
          const qualificationId = `qualification:${training.id}`;
          if (!record.qualifications.some((qualification) => qualification.id === qualificationId)) {
            record.qualifications.push({
              id: qualificationId,
              name: training.certificate_name,
              award: "Prototype community skills certificate",
              institution_id: training.institution_id,
              completed_day: context.day,
              career_links: [...training.career_links],
            });
          }
          const tertiaryStillActive = record.tertiary_enrollment !== null && record.tertiary_enrollment.status !== "completed";
          const secondaryCertificateEarned = record.qualifications.some((qualification) =>
            qualification.id === "qualification:secondary-school-certificate");
          record.progression_status = tertiaryStillActive
            ? "tertiary_active"
            : secondaryCertificateEarned ? "secondary_complete" : "active";
        }
        appendEvent(record, complete ? "training_completed" : "training_session_completed", context.day, {
          training_program_id: training.id,
          sessions_completed: nextSessions,
          skill_id: training.skill_id,
        });
        syncLegacyEducation(character, catalog);
        return success(complete ? "education_training_completed" : "education_training_progressed",
          complete ? `You completed ${training.name}, earned a certificate and strengthened ${training.skill_id}.`
            : `${training.name}: ${nextSessions}/${required} practical sessions complete.`, { skill, sessions_completed: nextSessions, required_sessions: required });
      }
      case "apply_scholarship": {
        const scholarshipId = payload.scholarship_id;
        const scholarship = typeof scholarshipId === "string"
          ? catalog.scholarships.find((entry) => entry.id === scholarshipId)
          : undefined;
        if (!scholarship) return failure("education_scholarship_unavailable", "That study award is not available.");
        if (record.scholarships.some((award) => award.scholarship_id === scholarship.id && award.status === "awarded")) {
          return failure("education_scholarship_exists", "You already hold this award.");
        }
        if ((options.scholarshipAwardsUsed?.[scholarship.id] ?? 0) >= scholarship.capacity) {
          return failure("education_scholarship_capacity", "This prototype award has reached its limited intake.");
        }
        const average = currentReportAverage(record, catalog);
        const needEligible = scholarship.maximum_money_ngn === null || character.money <= scholarship.maximum_money_ngn;
        if (average < scholarship.minimum_secondary_average || !needEligible) {
          return failure("education_scholarship_ineligible", scholarship.kind === "merit"
            ? `The configured merit threshold is ${scholarship.minimum_secondary_average}%.`
            : "The bursary is currently for students who meet its configured financial-need threshold.");
        }
        const award = {
          scholarship_id: scholarship.id,
          name: scholarship.name,
          kind: scholarship.kind,
          awarded_day: context.day,
          funding_balance_ngn: scholarship.award_amount_ngn,
          duration_terms: scholarship.duration_terms,
          remaining_terms: scholarship.duration_terms,
          status: "awarded" as const,
        };
        record.scholarships.push(award);
        appendEvent(record, "scholarship_awarded", context.day, { scholarship_id: scholarship.id, funding_ngn: scholarship.award_amount_ngn });
        return success("education_scholarship_awarded", `${scholarship.name} added ₦${scholarship.award_amount_ngn} to your education funding balance. It can reduce configured fees; it is not a bank account.`, { award });
      }
      case "family_support": {
        if (context.currentLocation !== "home") return failure("education_family_support_location_required", "Speak with your family at home about study costs.");
        const guardians = Array.isArray(context.household.guardians) ? context.household.guardians.length : 0;
        if (guardians < catalog.family_support.minimum_guardians ||
          character.money > catalog.family_support.eligibility_maximum_player_balance_ngn) {
          return failure("education_family_support_unavailable", "Family study support is not available for this request; check the fee plan or scholarship routes.");
        }
        if (record.family_support_claims.some((claim) => claim.academic_year === record.academic_year && claim.term === record.term)) {
          return failure("education_family_support_already_used", "Family support has already been requested for this term.");
        }
        const amount = catalog.family_support.support_amount_ngn;
        character.money += amount;
        record.family_support_claims.push({ academic_year: record.academic_year, term: record.term, amount_ngn: amount, day: context.day });
        appendEvent(record, "family_study_support_received", context.day, { amount_ngn: amount });
        syncLegacyEducation(character, catalog);
        return success("education_family_support_received", `Your guardians helped with ₦${amount} toward education costs.`, { amount_ngn: amount });
      }
      case "attend_activity": {
        const activityId = payload.activity_id;
        const activity = typeof activityId === "string"
          ? catalog.activities.find((entry) => entry.id === activityId)
          : undefined;
        if (!activity) return failure("education_activity_unavailable", "That school activity is not scheduled.");
        const schedule = scheduleForStudent(record, context.day, catalog).find((entry) =>
          entry.activity_id === activity.id);
        if (!schedule || context.currentLocation !== activity.location_id) return failure("education_activity_location_required", "Go to the scheduled school location before joining this activity.");
        if (context.minuteOfDay < schedule.start_minute - 10 ||
          context.minuteOfDay > schedule.start_minute + schedule.duration_minutes + catalog.calendar.late_grace_minutes) {
          return failure("education_activity_not_in_session", "That activity is not happening at this game time.");
        }
        if (record.attendance_records.some((entry) => entry.day === context.day && entry.schedule_id === schedule.id)) {
          return failure("education_activity_already_attended", "This scheduled activity has already been recorded today.");
        }
        const attendance = recordSchoolAttendance(record, schedule, context.day, context.minuteOfDay, undefined, catalog);
        if (attendance.status === "absent") return failure("education_activity_missed", "This activity has already been recorded as missed today.");
        character.energy = Math.max(0, character.energy - activity.energy_cost);
        character.reputation = Math.min(100, character.reputation + activity.relationship_bonus);
        appendEvent(record, "school_activity_completed", context.day, { activity_id: activity.id, kind: activity.kind });
        return success("education_activity_completed", `You joined ${activity.name}. It used some energy and helped you connect with classmates.`);
      }
      default:
        return failure("education_action_unknown", "That education action is not available.");
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "education_action_failed";
    return failure(code, educationErrorMessage(code));
  }
}

export function beginFinalExamPayload(
  record: StudentEducationRecord,
  day: number,
  catalog: EducationCatalog = loadEducationCatalog(),
): Record<string, unknown> | null {
  const next = nextFinalExamQuestion(record, day, catalog);
  if (!next) return null;
  return {
    registration_id: next.registration.registration_id,
    subject_id: next.subject_id,
    question_id: next.question.id,
    subject: catalog.subjects.find((subject) => subject.id === next.subject_id)?.name ?? next.subject_id,
    question: next.question.prompt,
    options: [...next.question.choices],
  };
}

export function beginTertiaryCoursePayload(
  record: StudentEducationRecord,
  catalog: EducationCatalog = loadEducationCatalog(),
): Record<string, unknown> | null {
  const enrollment = record.tertiary_enrollment;
  const program = activeProgram(record, catalog);
  if (!enrollment || !program || enrollment.status === "completed") return null;
  const course = enrollment.course_ids
    .map((courseId) => catalog.courses.find((candidate) => candidate.id === courseId))
    .find((candidate) => candidate !== undefined &&
      (enrollment.course_scores[candidate.id]?.length ?? 0) < enrollment.semester);
  if (!course) return null;
  const question = catalog.questions.find((candidate) => candidate.id === course.question_id);
  if (!question) return null;
  const prior = enrollment.course_scores[course.id]?.length ?? 0;
  return {
    course_id: course.id,
    course_name: course.name,
    subject_id: course.subject_id,
    assessment_type: course.assessment_type,
    question_id: question.id,
    question: question.prompt,
    options: [...question.choices],
    course_attempt: prior + 1,
  };
}

export function recordTertiaryCourseAnswer(
  character: CharacterRecord,
  pending: { readonly course_id: string; readonly subject_id: string; readonly assessment_type: string; readonly question_id: string },
  answerIndex: number,
  day: number,
  catalog: EducationCatalog = loadEducationCatalog(),
): number {
  const enrollment = character.education_record.tertiary_enrollment;
  const course = catalog.courses.find((entry) => entry.id === pending.course_id &&
    entry.subject_id === pending.subject_id && entry.question_id === pending.question_id);
  const question = catalog.questions.find((entry) => entry.id === pending.question_id);
  if (!enrollment || enrollment.status === "completed" || !course || !question ||
    !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= question.choices.length) {
    throw new Error("education_course_answer_invalid");
  }
  const score = answerIndex === question.correct_choice_index ? 90 : 40;
  const scores = enrollment.course_scores[course.id] ?? [];
  scores.push(score);
  if (scores.length > 100) scores.shift();
  enrollment.course_scores[course.id] = scores;
  character.education_record.assessment_records.push({
    assessment_id: makeId("course-assessment"),
    academic_year: character.education_record.academic_year,
    term: character.education_record.term,
    day,
    subject_id: course.subject_id,
    assessment_type: course.assessment_type,
    score,
    maximum_score: 100,
    question_id: question.id,
    source: "tertiary_course",
  });
  appendEvent(character.education_record, "tertiary_course_assessed", day, {
    course_id: course.id,
    score,
    semester: enrollment.semester,
  });
  syncLegacyEducation(character, catalog);
  return score;
}

export function publicQuestion(question: EducationQuestion): Record<string, unknown> {
  return { question: question.prompt, options: [...question.choices] };
}

export function recordSchoolQuizAnswer(
  character: CharacterRecord,
  pending: { readonly schedule_id: string; readonly subject_id: string; readonly assessment_type: string; readonly question_id: string; readonly day: number; readonly question_correct_choice_index: number },
  answerIndex: number,
  minuteOfDay: number,
  catalog: EducationCatalog = loadEducationCatalog(),
): { score: number; correct: boolean } {
  const record = character.education_record;
  const question = catalog.questions.find((entry) => entry.id === pending.question_id && entry.subject_id === pending.subject_id);
  if (!question || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= question.choices.length) {
    throw new Error("education_school_answer_invalid");
  }
  const correct = answerIndex === pending.question_correct_choice_index;
  const score = correct ? 95 : 45;
  record.assessment_records.push({
    assessment_id: makeId("assessment"),
    academic_year: record.academic_year,
    term: record.term,
    day: pending.day,
    subject_id: pending.subject_id,
    assessment_type: pending.assessment_type,
    score,
    maximum_score: 100,
    question_id: pending.question_id,
    source: "lesson",
  });
  if (record.assessment_records.length > MAX_EDUCATION_ASSESSMENTS) record.assessment_records.shift();
  character.academic_scores = legacyAcademicScores(record, catalog);
  character.attendance = legacyAttendanceRecords(record, catalog);
  character.energy = Math.max(0, character.energy - 0.5);
  appendEvent(record, "school_assessment_completed", pending.day, {
    subject_id: pending.subject_id,
    assessment_type: pending.assessment_type,
    score,
    correct,
  });
  return { score, correct };
}

export function publicSchoolQuiz(
  entry: ReturnType<typeof scheduleForStudent>[number],
  question: EducationQuestion,
  catalog: EducationCatalog = loadEducationCatalog(),
): Record<string, unknown> {
  return {
    schedule_id: entry.id,
    subject_id: entry.subject_id,
    subject: catalog.subjects.find((subject) => subject.id === entry.subject_id)?.name ?? entry.subject_id,
    assessment_type: entry.assessment_type ?? "continuous_assessment",
    question_id: question.id,
    question: question.prompt,
    options: [...question.choices],
    teacher_name: entry.teacher_name,
    classroom_name: entry.classroom_name,
    start_minute: entry.start_minute,
  };
}

export function findQuestionForSubject(
  subjectId: string,
  classId: string,
  catalog: EducationCatalog = loadEducationCatalog(),
): EducationQuestion | null {
  return catalog.questions.find((question) => question.subject_id === subjectId && question.class_ids.includes(classId)) ?? null;
}

export function syncLegacyEducation(
  character: CharacterRecord,
  catalog: EducationCatalog = loadEducationCatalog(),
): void {
  character.academic_scores = legacyAcademicScores(character.education_record, catalog);
  character.attendance = legacyAttendanceRecords(character.education_record, catalog);
  character.school_id = character.education_record.school_id;
  const record = character.education_record;
  const activeTraining = record.vocational_enrollments.find((entry) => entry.status === "active");
  const program = activeProgram(record, catalog);
  if (record.progression_status === "secondary_complete") character.education_level = "Secondary school complete";
  else if (program && record.tertiary_enrollment?.status !== "completed") character.education_level = `${program.award} · ${program.name}`;
  else if (activeTraining) character.education_level = `Vocational training · ${catalog.training_programs.find((entry) => entry.id === activeTraining.training_program_id)?.name ?? "Skills course"}`;
  else character.education_level = `Secondary school · ${catalog.school_years.find((entry) => entry.id === record.current_class_id)?.label ?? record.current_class_id}`;
}

export function legacyAcademicScores(
  record: StudentEducationRecord,
  catalog: EducationCatalog = loadEducationCatalog(),
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const subjectId of record.subject_ids) {
    const subject = catalog.subjects.find((entry) => entry.id === subjectId);
    if (!subject) continue;
    const latestReport = [...record.term_results].reverse().find((entry) =>
      entry.subject_results.some((score) => score.subject_id === subjectId));
    const score = latestReport?.subject_results.find((entry) => entry.subject_id === subjectId)?.score;
    if (score !== undefined) result[subject.legacy_score_key] = score;
    else {
      const records = record.assessment_records.filter((entry) => entry.subject_id === subjectId);
      result[subject.legacy_score_key] = records.length > 0
        ? Math.round(records.reduce((sum, entry) => sum + entry.score / entry.maximum_score * 100, 0) / records.length)
        : 0;
    }
  }
  return result;
}

export function legacyAttendanceRecords(
  record: StudentEducationRecord,
  catalog: EducationCatalog = loadEducationCatalog(),
): Array<Record<string, string | number>> {
  return record.attendance_records.slice(-MAX_EDUCATION_ATTENDANCE).map((entry) => ({
    day: entry.day,
    subject: catalog.subjects.find((subject) => subject.id === entry.subject_id)?.legacy_score_key ?? "School activity",
    status: entry.status,
    attended_at: `Day ${entry.day} · ${String(Math.floor(entry.recorded_at_minute / 60)).padStart(2, "0")}:${String(entry.recorded_at_minute % 60).padStart(2, "0")}`,
  }));
}

function activeProgram(
  record: StudentEducationRecord,
  catalog: EducationCatalog,
): EducationProgram | null {
  return record.tertiary_enrollment === null
    ? null
    : catalog.programs.find((program) => program.id === record.tertiary_enrollment?.program_id) ?? null;
}

function educationErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    education_term_not_active: "This term cannot be closed in the current enrollment state.",
    education_term_not_due: "The configured academic term is still in progress.",
    education_term_already_closed: "This term already has a saved result.",
    education_progression_not_available: "Class progression will be available after the final term result.",
    education_progression_choice_unavailable: "That progression choice is not available for this result.",
    education_class_unavailable: "The configured school class is not available.",
    education_final_exam_not_eligible: "Complete SS 3 before registering for the senior certificate examination.",
    education_final_exam_already_registered: "An exam registration is already in progress.",
    education_final_exam_subjects_invalid: "The selected final-exam subjects do not meet the configured subject rules.",
    education_final_exam_answer_invalid: "That examination response is invalid or already recorded.",
    education_course_answer_invalid: "That course assessment response is invalid.",
    education_school_answer_invalid: "That classroom response is invalid.",
  };
  return messages[code] ?? "The education action could not be completed.";
}

export function legacyAttendanceSummary(record: StudentEducationRecord): { attended: number; scheduled: number; percent: number } {
  const relevant = record.attendance_records.filter((entry) => entry.status !== "excused");
  const attended = relevant.filter((entry) => entry.status === "present" || entry.status === "late").length;
  return { attended, scheduled: relevant.length, percent: relevant.length === 0 ? 0 : Math.round(attended / relevant.length * 100) };
}

export function allEducationSubjectNames(record: StudentEducationRecord, catalog: EducationCatalog = loadEducationCatalog()): string[] {
  return record.subject_ids.map((subjectId) => catalog.subjects.find((subject) => subject.id === subjectId)?.name ?? subjectId);
}

export function educationCatalogSummary(catalog: EducationCatalog = loadEducationCatalog()): Record<string, unknown> {
  return {
    classes: catalog.school_years.map((schoolYear) => ({ id: schoolYear.id, label: schoolYear.label, stage: schoolYear.stage })),
    subjects: catalog.subjects.map((subject) => ({ id: subject.id, name: subject.name, category: subject.category })),
    institutions: catalog.institutions.map((institution) => ({
      id: institution.id, name: institution.name, kind: institution.kind, ownership: institution.ownership,
      program_ids: institution.program_ids ?? [], geographic_location: institution.geographic_location,
    })),
    programs: catalog.programs.map((program) => ({
      id: program.id, institution_id: program.institution_id, kind: program.kind, name: program.name,
      award: program.award, duration_years: program.duration_years,
      tuition_per_term_ngn: program.tuition_per_term_ngn, career_links: program.career_links,
    })),
    training_programs: catalog.training_programs.map(({ id, name, skill_id, session_cost_ngn, duration_sessions, institution_id }) => ({
      id, name, skill_id, session_cost_ngn, duration_sessions, institution_id,
    })),
    scholarships: catalog.scholarships.map(({ id, name, kind, minimum_secondary_average, award_amount_ngn }) => ({
      id, name, kind, minimum_secondary_average, award_amount_ngn,
    })),
    grading_model: catalog.grading.id,
    notice: catalog.notice,
  };
}


export function validateStudentSubjectChoices(
  record: StudentEducationRecord,
  selectedSubjectIds: readonly string[],
  catalog: EducationCatalog = loadEducationCatalog(),
): { ok: boolean; subject_ids: string[]; message: string } {
  const curriculum = curriculumFor(record, catalog);
  const unique = [...new Set(selectedSubjectIds)];
  const required = curriculum.compulsory_subject_ids;
  if (
    unique.length > curriculum.maximum_subject_count ||
    unique.some((subjectId) => !catalog.subjects.some((subject) => subject.id === subjectId)) ||
    !required.every((subjectId) => unique.includes(subjectId))
  ) return { ok: false, subject_ids: [...record.subject_ids], message: "Keep compulsory subjects and stay within the curriculum limit." };
  for (const group of curriculum.elective_groups) {
    const selectedCount = unique.filter((subjectId) => group.subject_ids.includes(subjectId)).length;
    if (selectedCount < group.minimum_choices || selectedCount > group.maximum_choices) {
      return { ok: false, subject_ids: [...record.subject_ids], message: `Choose ${group.minimum_choices}–${group.maximum_choices} electives in ${group.id}.` };
    }
  }
  record.subject_ids = unique;
  return { ok: true, subject_ids: unique, message: "Your optional subjects were updated for the current term." };
}

export function makeCourseAssessmentPreview(
  record: StudentEducationRecord,
  catalog: EducationCatalog = loadEducationCatalog(),
): Record<string, unknown> | null {
  return beginTertiaryCoursePayload(record, catalog);
}

export function schoolActivityForCurrentTime(
  record: StudentEducationRecord,
  day: number,
  minuteOfDay: number,
  location: string,
  catalog: EducationCatalog = loadEducationCatalog(),
): ResolvedEducationTimetableEntry | null {
  return scheduleForStudent(record, day, catalog).find((entry) =>
    entry.kind === "activity" && entry.location_id === location &&
    minuteOfDay >= entry.start_minute - 10 &&
    minuteOfDay <= entry.start_minute + entry.duration_minutes + catalog.calendar.late_grace_minutes) ?? null;
}

export function normalizeEducationRecord(
  value: unknown,
  characterId: string,
  age: number,
  schoolId: string,
  academicScores: Record<string, number>,
  legacyAttendance: readonly Record<string, unknown>[],
  day: number,
  catalog: EducationCatalog = loadEducationCatalog(),
): StudentEducationRecord {
  if (value === undefined || value === null) {
    return migrateEducationRecord(characterId, age, schoolId, academicScores, legacyAttendance, day, catalog);
  }
  if (!isEducationStudentRecord(value)) throw new Error("World data contains an invalid education record.");
  if (value.character_id !== characterId || value.student_id !== `student-${characterId}`) {
    throw new Error("World data education identity does not match its character.");
  }
  if (!catalog.institutions.some((institution) => institution.id === value.school_id && institution.kind === "secondary_school")) {
    throw new Error("World data education record refers to an unknown school.");
  }
  if (!catalog.school_years.some((schoolYear) => schoolYear.id === value.current_class_id)) {
    throw new Error("World data education record refers to an unknown school class.");
  }
  if (!value.subject_ids.every((subjectId) => catalog.subjects.some((subject) => subject.id === subjectId))) {
    throw new Error("World data education record refers to an unknown subject.");
  }
  return value;
}
