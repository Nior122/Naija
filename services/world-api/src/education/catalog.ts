import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAkureSouthRegion } from "../geography/catalog.js";
import type { EducationCatalog } from "./types.js";

const CATALOG_FILE = "game/data/education/catalog.json";

function repositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(candidate, CATALOG_FILE))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not locate ${CATALOG_FILE}; the education catalog is required.`);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function uniqueIds(values: readonly { readonly id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value.id !== "string" || value.id.length === 0 || seen.has(value.id)) {
      throw new Error(`${label} contains a missing or duplicate ID.`);
    }
    seen.add(value.id);
  }
}

function validateCatalog(value: unknown): EducationCatalog {
  assertRecord(value, "Education catalog");
  if (
    value.schema_version !== 1 ||
    value.world_id !== "nigeria-main" ||
    typeof value.notice !== "string" ||
    !Array.isArray(value.subjects) ||
    !Array.isArray(value.school_years) ||
    !Array.isArray(value.curricula) ||
    !Array.isArray(value.institutions) ||
    !Array.isArray(value.classrooms) ||
    !Array.isArray(value.teachers) ||
    !Array.isArray(value.npc_students) ||
    !Array.isArray(value.timetable) ||
    !Array.isArray(value.activities) ||
    !Array.isArray(value.assessment_types) ||
    !Array.isArray(value.questions) ||
    !Array.isArray(value.skills) ||
    typeof value.starting_diagnostic_scores !== "object" || value.starting_diagnostic_scores === null || Array.isArray(value.starting_diagnostic_scores) ||
    !Array.isArray(value.programs) ||
    !Array.isArray(value.courses) ||
    !Array.isArray(value.training_programs) ||
    !Array.isArray(value.scholarships)
  ) {
    throw new Error("Education catalog is incomplete or has an unsupported schema/world.");
  }

  const catalog = value as unknown as EducationCatalog;
  uniqueIds(catalog.subjects, "Education subjects");
  uniqueIds(catalog.school_years, "School years");
  uniqueIds(catalog.curricula, "Curricula");
  uniqueIds(catalog.institutions, "Institutions");
  uniqueIds(catalog.classrooms, "Classrooms");
  uniqueIds(catalog.teachers, "Teachers");
  uniqueIds(catalog.npc_students, "NPC students");
  uniqueIds(catalog.timetable, "Timetable");
  uniqueIds(catalog.activities, "Activities");
  uniqueIds(catalog.assessment_types, "Assessment types");
  uniqueIds(catalog.questions, "Education questions");
  uniqueIds(catalog.skills, "Education skills");
  uniqueIds(catalog.programs, "Education programs");
  uniqueIds(catalog.courses, "Tertiary courses");
  uniqueIds(catalog.training_programs, "Training programs");
  uniqueIds(catalog.scholarships, "Scholarships");

  const subjects = new Set(catalog.subjects.map((subject) => subject.id));
  const classes = new Set(catalog.school_years.map((schoolYear) => schoolYear.id));
  for (const [subjectId, score] of Object.entries(catalog.starting_diagnostic_scores)) {
    if (!subjects.has(subjectId) || !Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error("Starting diagnostic scores must reference known subjects and be 0–100.");
    }
  }
  const teachers = new Set(catalog.teachers.map((teacher) => teacher.id));
  const classrooms = new Set(catalog.classrooms.map((classroom) => classroom.id));
  const institutions = new Set(catalog.institutions.map((institution) => institution.id));
  const curricula = new Set(catalog.curricula.map((curriculum) => curriculum.id));
  const questions = new Set(catalog.questions.map((question) => question.id));
  const activities = new Set(catalog.activities.map((activity) => activity.id));
  const assessmentTypes = new Set(catalog.assessment_types.map((assessment) => assessment.id));
  const programIds = new Set(catalog.programs.map((program) => program.id));
  const courseIds = new Set(catalog.courses.map((course) => course.id));
  const trainingIds = new Set(catalog.training_programs.map((training) => training.id));
  const subjectSlots = new Set(catalog.curricula.flatMap((curriculum) => curriculum.elective_groups.map((group) => group.id)));
  const scheduleIds = new Set(catalog.timetable.map((entry) => entry.id));

  if (
    !Number.isSafeInteger(catalog.calendar.term_length_game_days) ||
    catalog.calendar.term_length_game_days < 1 ||
    !Number.isSafeInteger(catalog.calendar.terms_per_academic_year) ||
    catalog.calendar.terms_per_academic_year < 1 ||
    catalog.calendar.school_days_of_week.length === 0 ||
    catalog.calendar.school_days_of_week.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    !Number.isFinite(catalog.grading.attendance_weight) ||
    catalog.grading.attendance_weight < 0 ||
    catalog.grading.attendance_weight > 0.5 ||
    !Number.isFinite(catalog.grading.pass_score) ||
    catalog.grading.pass_score < 0 ||
    catalog.grading.pass_score > 100
  ) {
    throw new Error("Education calendar or grading configuration is invalid.");
  }

  for (const schoolYear of catalog.school_years) {
    if (schoolYear.next_class_id !== null && !classes.has(schoolYear.next_class_id)) {
      throw new Error(`School year ${schoolYear.id} refers to an unknown next class.`);
    }
  }
  for (const curriculum of catalog.curricula) {
    if (!curriculum.class_ids.every((classId) => classes.has(classId))) {
      throw new Error(`Curriculum ${curriculum.id} refers to an unknown class.`);
    }
    for (const group of curriculum.elective_groups) {
      if (group.minimum_choices < 0 || group.maximum_choices < group.minimum_choices || group.subject_ids.length === 0) {
        throw new Error(`Curriculum ${curriculum.id} has an invalid elective group.`);
      }
    }
    if (curriculum.maximum_subject_count < curriculum.compulsory_subject_ids.length) {
      throw new Error(`Curriculum ${curriculum.id} cannot fit its compulsory subjects.`);
    }
    const curriculumSubjects = [
      ...curriculum.compulsory_subject_ids,
      ...curriculum.default_elective_subject_ids,
      ...curriculum.elective_groups.flatMap((group) => group.subject_ids),
    ];
    if (!curriculumSubjects.every((subjectId) => subjects.has(subjectId))) {
      throw new Error(`Curriculum ${curriculum.id} refers to an unknown subject.`);
    }
    if (!curriculum.default_elective_subject_ids.every((subjectId) =>
      curriculum.elective_groups.some((group) => group.subject_ids.includes(subjectId)))) {
      throw new Error(`Curriculum ${curriculum.id} has an invalid default elective selection.`);
    }
  }

  const region = loadAkureSouthRegion();
  const regionBounds = region.viewport.bounds_wgs84;
  for (const institution of catalog.institutions) {
    const location = institution.geographic_location;
    if (
      !institutions.has(institution.id) ||
      !institution.fictional ||
      location.world_id !== "nigeria-main" ||
      location.region_id !== region.id ||
      location.state_id !== region.state_id ||
      location.lga_id !== region.lga_id ||
      location.coordinate_origin !== "synthetic_gameplay_anchor" ||
      !location.state_name || !location.lga_name || !location.settlement_name ||
      !Number.isSafeInteger(institution.capacity) || institution.capacity < 1 ||
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude) ||
      location.longitude < regionBounds.west ||
      location.longitude > regionBounds.east ||
      location.latitude < regionBounds.south ||
      location.latitude > regionBounds.north
    ) {
      throw new Error(`Institution ${institution.id} has an invalid or unsourced prototype location.`);
    }
    if (institution.curriculum_id !== undefined && !curricula.has(institution.curriculum_id)) {
      throw new Error(`Institution ${institution.id} refers to an unknown curriculum.`);
    }
    if (institution.class_ids !== undefined && !institution.class_ids.every((classId) => classes.has(classId))) {
      throw new Error(`Institution ${institution.id} refers to an unknown school class.`);
    }
    if (institution.program_ids !== undefined && institution.program_ids.some((programId) => !programIds.has(programId))) {
      throw new Error(`Institution ${institution.id} refers to an unknown tertiary program.`);
    }
    for (const fee of [institution.annual_fee_ngn, institution.application_fee_ngn, institution.registration_fee_ngn, institution.tuition_per_term_ngn]) {
      if (fee !== undefined && (!Number.isSafeInteger(fee) || fee < 0)) {
        throw new Error(`Institution ${institution.id} has an invalid prototype fee.`);
      }
    }
  }

  for (const student of catalog.npc_students) {
    if (!student.fictional || !institutions.has(student.institution_id) || !classes.has(student.class_id) ||
      !Number.isSafeInteger(student.age) || student.age < 10 || student.age > 25) {
      throw new Error(`NPC student ${student.id} has an invalid institution, class, age or fiction flag.`);
    }
  }
  for (const activity of catalog.activities) {
    if (!Number.isFinite(activity.duration_minutes) || activity.duration_minutes < 1 ||
      !Number.isFinite(activity.energy_cost) || activity.energy_cost < 0 ||
      !Number.isFinite(activity.academic_bonus) || activity.academic_bonus < 0 ||
      !Number.isFinite(activity.relationship_bonus) || activity.relationship_bonus < 0 ||
      !["schoolyard", "classroom", "campus", "training_center"].includes(activity.location_id)) {
      throw new Error(`Activity ${activity.id} has an invalid duration, effect or location.`);
    }
  }
  for (const classroom of catalog.classrooms) {
    if (!institutions.has(classroom.institution_id) || !classes.has(classroom.class_id)) {
      throw new Error(`Classroom ${classroom.id} refers to an unknown institution or class.`);
    }
  }
  for (const teacher of catalog.teachers) {
    if (
      !institutions.has(teacher.institution_id) ||
      !teacher.subject_ids.every((subjectId) => subjects.has(subjectId)) ||
      !teacher.classroom_ids.every((classroomId) => classrooms.has(classroomId)) ||
      !teacher.schedule_ids.every((scheduleId) => scheduleIds.has(scheduleId) || programIds.has(scheduleId) || trainingIds.has(scheduleId))
    ) {
      throw new Error(`Teacher ${teacher.id} has an invalid school, subject or classroom reference.`);
    }
  }
  for (const entry of catalog.timetable) {
    if (
      entry.days_of_week.length === 0 ||
      entry.days_of_week.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
      !Number.isInteger(entry.start_minute) || entry.start_minute < 0 || entry.start_minute >= 1440 ||
      !Number.isInteger(entry.duration_minutes) || entry.duration_minutes < 1 ||
      !entry.class_ids.every((classId) => classes.has(classId)) ||
      (entry.subject_id !== undefined && !subjects.has(entry.subject_id)) ||
      (entry.subject_slot_id !== undefined && !subjectSlots.has(entry.subject_slot_id)) ||
      (entry.assessment_type !== undefined && !assessmentTypes.has(entry.assessment_type)) ||
      (entry.activity_id !== undefined && !activities.has(entry.activity_id)) ||
      (entry.teacher_id !== null && entry.teacher_id !== undefined && !teachers.has(entry.teacher_id)) ||
      (entry.classroom_id !== null && !classrooms.has(entry.classroom_id))
    ) {
      throw new Error(`Timetable entry ${entry.id} is invalid.`);
    }
    if (entry.kind === "activity" && entry.activity_id &&
      !catalog.activities.some((activity) => activity.id === entry.activity_id)) {
      throw new Error(`Timetable entry ${entry.id} refers to an unknown activity.`);
    }
  }
  for (const question of catalog.questions) {
    if (
      !subjects.has(question.subject_id) ||
      !question.original_game_content ||
      question.choices.length < 2 ||
      !Number.isInteger(question.correct_choice_index) ||
      question.correct_choice_index < 0 ||
      question.correct_choice_index >= question.choices.length ||
      !question.class_ids.every((classId) => classes.has(classId))
    ) {
      throw new Error(`Question ${question.id} is not valid original game content.`);
    }
  }
  for (const program of catalog.programs) {
    if (
      !institutions.has(program.institution_id) ||
      !Number.isInteger(program.duration_semesters) ||
      program.duration_semesters < 1 ||
      program.capacity < 1 ||
      !program.course_ids.every((courseId) => courseIds.has(courseId)) ||
      !catalog.institutions.find((institution) => institution.id === program.institution_id)?.program_ids?.includes(program.id) ||
      !program.requirements.required_subject_ids.every((subjectId) => subjects.has(subjectId)) ||
      (program.requirements.required_qualification_ids ?? []).some((qualificationId) => qualificationId.length > 100)
    ) {
      throw new Error(`Program ${program.id} has invalid institution, duration, courses or entry requirements.`);
    }
  }
  for (const course of catalog.courses) {
    if (!subjects.has(course.subject_id) || !questions.has(course.question_id)) {
      throw new Error(`Course ${course.id} refers to an unknown subject or question.`);
    }
  }
  for (const training of catalog.training_programs) {
    if (!institutions.has(training.institution_id) || !teachers.has(training.master_teacher_id) ||
      !catalog.skills.some((skill) => skill.id === training.skill_id) ||
      !Number.isSafeInteger(training.duration_sessions) || training.duration_sessions < 1 ||
      !Number.isSafeInteger(training.session_cost_ngn) || training.session_cost_ngn < 0 ||
      !catalog.institutions.find((institution) => institution.id === training.institution_id)?.geographic_location) {
      throw new Error(`Training program ${training.id} refers to an unknown institution, mentor or skill, or has invalid session values.`);
    }
  }
  if (!catalog.final_examination.required_credit_subject_ids.every((subjectId) => subjects.has(subjectId)) ||
    !catalog.grading.final_exam_required_subject_ids.every((subjectId) => subjects.has(subjectId)) ||
    !catalog.final_examination.required_credit_subject_ids.every((subjectId) => catalog.grading.final_exam_required_subject_ids.includes(subjectId))) {
    throw new Error("Final examination credit rules refer to unknown or inconsistent core subjects.");
  }
  for (const scholarship of catalog.scholarships) {
    if (!Number.isSafeInteger(scholarship.capacity) || scholarship.capacity < 1 ||
      !Number.isSafeInteger(scholarship.award_amount_ngn) || scholarship.award_amount_ngn < 0 ||
      !Number.isSafeInteger(scholarship.duration_terms) || scholarship.duration_terms < 1) {
      throw new Error(`Scholarship ${scholarship.id} has invalid prototype award limits.`);
    }
  }

  return catalog;
}

let cachedCatalog: EducationCatalog | null = null;

export function loadEducationCatalog(): EducationCatalog {
  if (cachedCatalog !== null) return cachedCatalog;
  const configuredDirectory = process.env.NAIJA_EDUCATION_DATA_DIR;
  const filePath = configuredDirectory
    ? resolve(configuredDirectory, "catalog.json")
    : join(repositoryRoot(), CATALOG_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Could not load education catalog at ${filePath}.`, { cause: error });
  }
  cachedCatalog = validateCatalog(parsed);
  return cachedCatalog;
}

export function validateEducationCatalogForTest(value: unknown): EducationCatalog {
  return validateCatalog(value);
}
