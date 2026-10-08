class_name EducationService
extends RefCounted

const CATALOG_PATH: String = "res://data/education/catalog.json"
const MAX_EVENTS: int = 10000
const MAX_ATTENDANCE: int = 10000
const MAX_ASSESSMENTS: int = 20000
const MAX_RESULTS: int = 1000

static var _catalog_cache: Dictionary = {}


static func catalog() -> Dictionary:
	if _catalog_cache.is_empty():
		if not FileAccess.file_exists(CATALOG_PATH):
			push_error("The Stage 4 education catalog is missing: %s" % CATALOG_PATH)
			return {}
		var file := FileAccess.open(CATALOG_PATH, FileAccess.READ)
		if file == null:
			push_error("Could not open the Stage 4 education catalog.")
			return {}
		var parsed: Variant = JSON.parse_string(file.get_as_text())
		file.close()
		if not parsed is Dictionary or int(parsed.get("schema_version", 0)) != 1:
			push_error("The Stage 4 education catalog has an invalid schema.")
			return {}
		if str(parsed.get("world_id", "")) != "nigeria-main":
			push_error("The education catalog must use the single Nigeria world ID.")
			return {}
		_catalog_cache = parsed
	return _catalog_cache.duplicate(true)


static func create_student_record(character_id: String, age: int, day: int = 1) -> Dictionary:
	var data := catalog()
	var school := _find_by_kind(data.get("institutions", []), "secondary_school")
	var curriculum := _find_by_id(data.get("curricula", []), str(school.get("curriculum_id", "")))
	var class_by_age: Dictionary = data.get("calendar", {}).get("starting_class_by_age", {})
	var starting_class := str(class_by_age.get(str(age), "SS1"))
	var class_ids: Array = curriculum.get("class_ids", [])
	if not class_ids.has(starting_class):
		starting_class = "SS1"
	var selected_subjects: Array[String] = []
	for subject_id in curriculum.get("compulsory_subject_ids", []):
		selected_subjects.append(str(subject_id))
	for subject_id in curriculum.get("default_elective_subject_ids", []):
		if not selected_subjects.has(str(subject_id)):
			selected_subjects.append(str(subject_id))
	var record := {
		"schema_version": 1,
		"student_id": "student-" + character_id,
		"character_id": character_id,
		"school_id": str(school.get("id", "idera_secondary_school")),
		"current_class_id": starting_class,
		"academic_year": 1,
		"term": 1,
		"term_start_day": maxi(1, day),
		"enrollment_status": "enrolled",
		"progression_status": "active",
		"subject_ids": selected_subjects,
		"attendance_records": [],
		"assessment_records": [],
		"term_results": [],
		"final_exam_registrations": [],
		"final_exam_attempts": [],
		"qualifications": [],
		"skills": [],
		"admission_applications": [],
		"tertiary_enrollment": null,
		"vocational_enrollments": [],
		"apprenticeships": [],
		"scholarships": [],
		"education_events": [],
		"family_support_claims": [],
	}
	var starting_scores: Dictionary = data.get("starting_diagnostic_scores", {})
	for subject_id in starting_scores:
		if selected_subjects.has(str(subject_id)):
			_add_assessment(
				record,
				str(subject_id),
				"continuous_assessment",
				float(starting_scores[subject_id]),
				"starter-diagnostic",
				"teacher_entry",
				day
			)
	_add_event(
		record,
		"student_enrolled",
		day,
		{
			"school_id": record.school_id,
			"class_id": starting_class,
			"subject_count": selected_subjects.size(),
		}
	)
	return record


static func migrate_legacy_record(
	character_id: String,
	age: int,
	school_id: String,
	academic_scores: Dictionary,
	legacy_attendance: Array,
	day: int = 1
) -> Dictionary:
	var record := create_student_record(character_id, age, day)
	var data := catalog()
	var school := _find_by_id(data.get("institutions", []), school_id)
	if str(school.get("kind", "")) == "secondary_school":
		record.school_id = school_id
	var subjects: Array = data.get("subjects", [])
	for subject in subjects:
		var key := str(subject.get("legacy_score_key", ""))
		var legacy_score: Variant = academic_scores.get(
			key, academic_scores.get(str(subject.get("name", "")), null)
		)
		if legacy_score is int or legacy_score is float:
			if float(legacy_score) < 0.0 or float(legacy_score) > 100.0:
				continue
			record.assessment_records = record.assessment_records.filter(
				func(entry: Dictionary) -> bool:
					return str(entry.get("subject_id", "")) != str(subject.id)
			)
			_add_assessment(
				record,
				str(subject.id),
				"continuous_assessment",
				float(legacy_score),
				"legacy-diagnostic",
				"teacher_entry",
				day
			)
	var used: Dictionary = {}
	for legacy_entry in legacy_attendance.slice(maxi(0, legacy_attendance.size() - MAX_ATTENDANCE)):
		if not legacy_entry is Dictionary:
			continue
		var subject_label := str(legacy_entry.get("subject", ""))
		var subject_id := ""
		for subject in subjects:
			if (
				subject_label == str(subject.get("legacy_score_key", ""))
				or subject_label == str(subject.get("name", ""))
			):
				subject_id = str(subject.get("id", ""))
				break
		var record_day := maxi(1, int(legacy_entry.get("day", day)))
		var key := (
			"%d:%s" % [record_day, subject_id if not subject_id.is_empty() else subject_label]
		)
		if used.has(key):
			continue
		used[key] = true
		(
			record
			. attendance_records
			. append(
				{
					"attendance_id": _new_id("attendance"),
					"academic_year": record.academic_year,
					"term": record.term,
					"day": record_day,
					"schedule_id": "legacy-" + key,
					"class_id": record.current_class_id,
					"subject_id": subject_id if not subject_id.is_empty() else null,
					"status": "present",
					"minutes_late": 0,
					"recorded_at_minute": 0,
				}
			)
		)
	return record


static func ensure_character_record(character: Object, day: int = 1) -> Dictionary:
	var existing: Variant = character.get("education_record")
	var record: Dictionary
	if existing is Dictionary and _record_shape_is_valid(existing):
		record = existing
	else:
		var old_scores: Variant = character.get("academic_scores")
		var scores: Dictionary = old_scores if old_scores is Dictionary else {}
		var old_attendance: Variant = character.get("attendance")
		var attendance: Array = old_attendance if old_attendance is Array else []
		record = migrate_legacy_record(
			str(character.get("character_id")),
			int(character.get("age")),
			str(character.get("school_id")),
			scores,
			attendance,
			day
		)
	character.set("education_record", record)
	sync_legacy_character(character)
	return record


static func _record_shape_is_valid(record: Dictionary) -> bool:
	if int(record.get("schema_version", 0)) != 1:
		return false
	if (
		str(record.get("student_id", "")).is_empty()
		or str(record.get("character_id", "")).is_empty()
	):
		return false
	if not record.get("subject_ids", []) is Array:
		return false
	for key in [
		"attendance_records",
		"assessment_records",
		"term_results",
		"final_exam_registrations",
		"final_exam_attempts",
		"qualifications",
		"skills",
		"admission_applications",
		"vocational_enrollments",
		"apprenticeships",
		"scholarships",
		"education_events",
		"family_support_claims",
	]:
		if not record.get(key, []) is Array:
			return false
	return true


static func sync_legacy_character(character: Object) -> void:
	var record_value: Variant = character.get("education_record")
	if not record_value is Dictionary or not _record_shape_is_valid(record_value):
		return
	var record: Dictionary = record_value
	var data := catalog()
	character.set("school_id", str(record.get("school_id", "idera_secondary_school")))
	var class_entry := _find_by_id(
		data.get("school_years", []), str(record.get("current_class_id", "SS1"))
	)
	var education_level := (
		"Secondary school · %s"
		% str(class_entry.get("label", record.get("current_class_id", "SS1")))
	)
	var tertiary: Variant = record.get("tertiary_enrollment", null)
	if tertiary is Dictionary and str(tertiary.get("status", "")) != "completed":
		var program := _find_by_id(data.get("programs", []), str(tertiary.get("program_id", "")))
		education_level = (
			"%s · %s"
			% [
				str(tertiary.get("award", "Tertiary study")),
				str(program.get("name", "Tertiary program"))
			]
		)
	elif str(record.get("progression_status", "")) in ["secondary_complete", "tertiary_complete"]:
		education_level = (
			"Secondary school complete"
			if str(record.get("progression_status", "")) == "secondary_complete"
			else "Tertiary qualification complete"
		)
	else:
		for enrollment in record.get("vocational_enrollments", []):
			if str(enrollment.get("status", "")) == "active":
				var training := _find_by_id(
					data.get("training_programs", []),
					str(enrollment.get("training_program_id", ""))
				)
				education_level = (
					"Vocational training · %s" % str(training.get("name", "Skills course"))
				)
				break
	character.set("education_level", education_level)
	character.set("academic_scores", legacy_academic_scores(record))
	character.set("attendance", legacy_attendance_records(record))


static func legacy_academic_scores(record: Dictionary) -> Dictionary:
	var scores: Dictionary = {}
	var data := catalog()
	var subjects: Array = data.get("subjects", [])
	for subject_id in record.get("subject_ids", []):
		var subject := _find_by_id(subjects, str(subject_id))
		if subject.is_empty():
			continue
		var score := -1.0
		var results: Array = record.get("term_results", [])
		for result_index in range(results.size() - 1, -1, -1):
			var result: Dictionary = results[result_index]
			for subject_result in result.get("subject_results", []):
				if str(subject_result.get("subject_id", "")) == str(subject_id):
					score = float(subject_result.get("score", 0.0))
					break
			if score >= 0.0:
				break
		if score < 0.0:
			var assessments: Array = []
			for entry in record.get("assessment_records", []):
				if str(entry.get("subject_id", "")) == str(subject_id):
					assessments.append(entry)
			if not assessments.is_empty():
				var total := 0.0
				for entry in assessments:
					total += (
						float(entry.get("score", 0.0))
						/ maxf(1.0, float(entry.get("maximum_score", 100.0)))
						* 100.0
					)
				score = roundf(total / float(assessments.size()))
		if score >= 0.0:
			scores[str(subject.get("legacy_score_key", subject.get("name", subject_id)))] = int(
				score
			)
	return scores


static func legacy_attendance_records(record: Dictionary) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	var data := catalog()
	for entry in record.get("attendance_records", []).slice(
		maxi(0, record.get("attendance_records", []).size() - MAX_ATTENDANCE)
	):
		var subject := _find_by_id(data.get("subjects", []), str(entry.get("subject_id", "")))
		var day := int(entry.get("day", 1))
		var minute := int(entry.get("recorded_at_minute", 0))
		(
			result
			. append(
				{
					"day": day,
					"subject": str(subject.get("legacy_score_key", "School activity")),
					"status": str(entry.get("status", "present")),
					"attended_at": "Day %d · %02d:%02d" % [day, int(minute / 60), minute % 60],
				}
			)
		)
	return result


static func subject_name(subject_id: String) -> String:
	return _subject_name(subject_id, catalog())


static func subject_names(record: Dictionary) -> Array[String]:
	var result: Array[String] = []
	var data := catalog()
	for subject_id in record.get("subject_ids", []):
		var subject := _find_by_id(data.get("subjects", []), str(subject_id))
		result.append(str(subject.get("name", subject_id)))
	return result


static func schedule_for_day(record: Dictionary, day: int) -> Array[Dictionary]:
	var data := catalog()
	var weekday := posmod(day - 1, 7)
	var curriculum := _curriculum_for(record, data)
	var result: Array[Dictionary] = []
	for entry_value in data.get("timetable", []):
		var entry: Dictionary = entry_value
		if not entry.get("days_of_week", []).has(weekday):
			continue
		if not entry.get("class_ids", []).has(str(record.get("current_class_id", ""))):
			continue
		var resolved := entry.duplicate(true)
		var subject_id := str(entry.get("subject_id", ""))
		if entry.has("subject_slot_id"):
			var group: Dictionary = {}
			for group_value in curriculum.get("elective_groups", []):
				if str(group_value.get("id", "")) == str(entry.get("subject_slot_id", "")):
					group = group_value
					break
			subject_id = ""
			for selected in record.get("subject_ids", []):
				if group.get("subject_ids", []).has(str(selected)):
					subject_id = str(selected)
					break
		if str(entry.get("kind", "")) == "lesson" and subject_id.is_empty():
			continue
		resolved["subject_id"] = subject_id if not subject_id.is_empty() else null
		resolved["subject_name"] = (
			_subject_name(subject_id, data) if not subject_id.is_empty() else ""
		)
		result.append(resolved)
	return result


static func next_lesson(record: Dictionary, day: int, minute_of_day: int) -> Dictionary:
	var data := catalog()
	var early_window := 30
	var grace := int(data.get("calendar", {}).get("late_grace_minutes", 15))
	for entry in schedule_for_day(record, day):
		if str(entry.get("kind", "")) != "lesson":
			continue
		if _has_attendance(record, day, str(entry.get("id", ""))):
			continue
		var start := int(entry.get("start_minute", 0))
		if minute_of_day >= start - early_window and minute_of_day <= start + grace:
			return entry
	return {}


static func current_activity(
	record: Dictionary, day: int, minute_of_day: int, location: String
) -> Dictionary:
	var data := catalog()
	var grace := int(data.get("calendar", {}).get("late_grace_minutes", 15))
	for entry in schedule_for_day(record, day):
		if (
			str(entry.get("kind", "")) != "activity"
			or str(entry.get("location_id", "")) != location
		):
			continue
		var start := int(entry.get("start_minute", 0))
		if (
			minute_of_day >= start - 10
			and minute_of_day <= start + int(entry.get("duration_minutes", 0)) + grace
		):
			return entry
	return {}


static func record_attendance(
	record: Dictionary,
	entry: Dictionary,
	day: int,
	minute_of_day: int,
	status_override: String = ""
) -> Dictionary:
	for attendance in record.get("attendance_records", []):
		if (
			int(attendance.get("day", 0)) == day
			and str(attendance.get("schedule_id", "")) == str(entry.get("id", ""))
		):
			return attendance
	var data := catalog()
	var lateness := maxi(0, minute_of_day - int(entry.get("start_minute", 0)))
	var grace := int(data.get("calendar", {}).get("late_grace_minutes", 15))
	var status := status_override
	if status.is_empty():
		status = "late" if lateness > grace else "present"
	var attendance := {
		"attendance_id": _new_id("attendance"),
		"academic_year": int(record.get("academic_year", 1)),
		"term": int(record.get("term", 1)),
		"day": day,
		"schedule_id": str(entry.get("id", "schedule")),
		"class_id": str(entry.get("class_id", record.get("current_class_id", "SS1"))),
		"subject_id": entry.get("subject_id", null),
		"status": status,
		"minutes_late": lateness if status == "late" else 0,
		"recorded_at_minute": clampi(minute_of_day, 0, 1439),
	}
	var records: Array = record.get("attendance_records", [])
	records.append(attendance)
	if records.size() > MAX_ATTENDANCE:
		records.pop_front()
	record["attendance_records"] = records
	_add_event(
		record,
		"class_absence_recorded" if status == "absent" else "class_attendance_recorded",
		day,
		{
			"schedule_id": attendance.schedule_id,
			"subject_id": attendance.subject_id,
			"status": status,
		}
	)
	return attendance


static func mark_missed_periods(record: Dictionary, day: int, minute_of_day: int) -> int:
	var data := catalog()
	var weekday := posmod(day - 1, 7)
	if (
		str(record.get("enrollment_status", "")) != "enrolled"
		or not data.get("calendar", {}).get("school_days_of_week", []).has(weekday)
	):
		return 0
	var marked := 0
	for entry in schedule_for_day(record, day):
		if (
			str(entry.get("kind", "")) == "break"
			or _has_attendance(record, day, str(entry.get("id", "")))
		):
			continue
		var end_minute := int(entry.get("start_minute", 0)) + int(entry.get("duration_minutes", 0))
		if minute_of_day > end_minute + int(data.get("calendar", {}).get("late_grace_minutes", 15)):
			record_attendance(record, entry, day, minute_of_day, "absent")
			marked += 1
	return marked


static func attendance_summary(record: Dictionary, year: int = -1, term: int = -1) -> Dictionary:
	var scheduled := 0
	var attended := 0
	for entry in record.get("attendance_records", []):
		if year >= 0 and int(entry.get("academic_year", -2)) != year:
			continue
		if term >= 0 and int(entry.get("term", -2)) != term:
			continue
		if str(entry.get("status", "")) == "excused":
			continue
		scheduled += 1
		if str(entry.get("status", "")) in ["present", "late"]:
			attended += 1
	return {
		"attended": attended,
		"scheduled": scheduled,
		"percent": roundi(float(attended) / float(scheduled) * 100.0) if scheduled > 0 else 0,
	}


static func record_result(
	character: Object, day: int, subject_name: String, correct: bool, time_label: String = ""
) -> int:
	var record := ensure_character_record(character, day)
	var subject_id := _subject_id_from_name(subject_name)
	if subject_id.is_empty() or not record.get("subject_ids", []).has(subject_id):
		return 0
	var schedule: Dictionary = {}
	for entry in schedule_for_day(record, day):
		if (
			str(entry.get("subject_id", "")) == subject_id
			and str(entry.get("kind", "")) == "lesson"
		):
			schedule = entry
			break
	if schedule.is_empty():
		schedule = {
			"id": "legacy-%s" % subject_id,
			"start_minute": 0,
			"subject_id": subject_id,
			"assessment_type": "continuous_assessment",
			"kind": "lesson",
		}
		if not _has_attendance(record, day, str(schedule.id)):
			schedule["id"] = "%s-%d" % [schedule.id, day]
	record_attendance(record, schedule, day, _minute_from_label(time_label))
	var score := 95.0 if correct else 45.0
	_add_assessment(
		record,
		subject_id,
		str(schedule.get("assessment_type", "continuous_assessment")),
		score,
		_question_id_for_subject(subject_id),
		"lesson",
		day
	)
	_add_event(
		record,
		"school_assessment_completed",
		day,
		{
			"subject_id": subject_id,
			"score": int(score),
			"correct": correct,
		}
	)
	sync_legacy_character(character)
	return int(character.get("academic_scores", {}).get(subject_name, roundi(score)))


static func close_current_term(character: Object, day: int) -> Dictionary:
	var record := ensure_character_record(character, day)
	var data := catalog()
	if (
		str(record.get("enrollment_status", "")) != "enrolled"
		or str(record.get("progression_status", "")) != "active"
	):
		return _failure(
			"education_term_not_active",
			"This term cannot be closed in the current enrollment state."
		)
	var calendar: Dictionary = data.get("calendar", {})
	if day < int(record.get("term_start_day", day)) + int(calendar.get("term_length_game_days", 5)):
		return _failure(
			"education_term_not_due", "The configured academic term is still in progress."
		)
	for prior_day in range(int(record.get("term_start_day", day)), day):
		mark_missed_periods(record, prior_day, 1439)
	for result in record.get("term_results", []):
		if (
			int(result.get("academic_year", -1)) == int(record.get("academic_year", 1))
			and int(result.get("term", -1)) == int(record.get("term", 1))
		):
			return _failure(
				"education_term_already_closed", "This term already has a saved result."
			)
	var attendance_percent := int(
		attendance_summary(record, int(record.academic_year), int(record.term)).percent
	)
	var subject_results: Array[Dictionary] = []
	var curriculum := _curriculum_for(record, data)
	for subject_id in record.get("subject_ids", []):
		var score := _subject_score(record, str(subject_id), data, attendance_percent)
		var grade := _grade_for_score(score, data)
		(
			subject_results
			. append(
				{
					"subject_id": str(subject_id),
					"score": score,
					"grade": grade.grade,
					"label": grade.label,
					"passed": score >= float(data.get("grading", {}).get("pass_score", 50)),
				}
			)
		)
	var overall := 0.0
	for result in subject_results:
		overall += float(result.score)
	if not subject_results.is_empty():
		overall = roundf(overall / float(subject_results.size()))
	var core_pass := true
	for result in subject_results:
		if (
			curriculum.get("compulsory_subject_ids", []).has(str(result.subject_id))
			and (
				float(result.score)
				< float(data.get("grading", {}).get("core_subject_minimum_score", 40))
			)
		):
			core_pass = false
	var eligible := (
		overall >= float(data.get("grading", {}).get("promotion_minimum_average", 50)) and core_pass
	)
	var overall_grade := _grade_for_score(overall, data)
	var term_result := {
		"result_id": _new_id("term-result"),
		"academic_year": int(record.academic_year),
		"term": int(record.term),
		"published_day": day,
		"attendance_percent": attendance_percent,
		"overall_average": int(overall),
		"overall_grade": overall_grade.grade,
		"promotion_eligible": eligible,
		"subject_results": subject_results,
	}
	var results: Array = record.get("term_results", [])
	results.append(term_result)
	if results.size() > MAX_RESULTS:
		results.pop_front()
	record.term_results = results
	_add_event(
		record,
		"term_result_published",
		day,
		{
			"result_id": term_result.result_id,
			"overall_average": int(overall),
			"attendance_percent": attendance_percent,
			"promotion_eligible": eligible,
		}
	)
	_advance_scholarship_term(record, day)
	if int(record.term) >= int(calendar.get("terms_per_academic_year", 3)):
		record.progression_status = "eligible_to_promote" if eligible else "remediation_available"
	else:
		record.term = int(record.term) + 1
		record.term_start_day = day
		record.progression_status = "active"
	sync_legacy_character(character)
	return {
		"ok": true,
		"code": "education_term_published",
		"message":
		(
			"Term result published: %s · %d%% overall · %d%% attendance."
			% [term_result.overall_grade, int(overall), attendance_percent]
		),
		"result": term_result
	}


static func choose_progression(character: Object, choice: String, day: int) -> Dictionary:
	var record := ensure_character_record(character, day)
	var data := catalog()
	var years: Array = data.get("school_years", [])
	if (
		(
			int(record.get("term", 0))
			!= int(data.get("calendar", {}).get("terms_per_academic_year", 3))
		)
		or (
			str(record.get("progression_status", ""))
			not in ["eligible_to_promote", "remediation_available"]
		)
	):
		return _failure(
			"education_progression_not_available",
			"Class progression will be available after the final term result."
		)
	if choice == "leave":
		record.enrollment_status = "left"
		record.progression_status = "left_school"
		_add_event(record, "secondary_school_left", day, {"class_id": record.current_class_id})
		sync_legacy_character(character)
		return _success(
			"education_progression_updated",
			(
				"You left secondary school with your education history preserved. "
				+ "Vocational and apprenticeship paths remain open."
			)
		)
	if choice in ["repeat", "remediate"]:
		record.academic_year = int(record.academic_year) + 1
		record.term = 1
		record.term_start_day = day
		record.progression_status = "active"
		_add_event(
			record,
			"class_repeated" if choice == "repeat" else "remedial_year_started",
			day,
			{"class_id": record.current_class_id}
		)
		sync_legacy_character(character)
		return _success(
			"education_progression_updated",
			"A fresh supported school year begins. Earlier results remain in your history."
		)
	if choice != "promote" or str(record.get("progression_status", "")) != "eligible_to_promote":
		return _failure(
			"education_progression_choice_unavailable",
			"That progression choice is not available for this result."
		)
	var current := _find_by_id(years, str(record.current_class_id))
	var next_class: Variant = current.get("next_class_id", null)
	if next_class == null:
		record.progression_status = "final_exam_eligible"
		_add_event(record, "secondary_school_completed", day, {"class_id": record.current_class_id})
		sync_legacy_character(character)
		return _success(
			"education_progression_updated",
			"You completed SS 3 and may register for the fictional senior certificate examination."
		)
	record.current_class_id = str(next_class)
	record.academic_year = int(record.academic_year) + 1
	record.term = 1
	record.term_start_day = day
	var curriculum := _curriculum_for(record, data)
	record.subject_ids = _default_subject_ids(curriculum)
	record.progression_status = "active"
	_add_event(
		record,
		"class_promoted",
		day,
		{"class_id": next_class, "academic_year": record.academic_year}
	)
	sync_legacy_character(character)
	return _success(
		"education_progression_updated",
		"You progressed to %s." % str(current.get("label", next_class))
	)


static func choose_subjects(character: Object, requested_subjects: Array, day: int) -> Dictionary:
	var record := ensure_character_record(character, day)
	var data := catalog()
	var curriculum := _curriculum_for(record, data)
	var selected: Array[String] = []
	for subject_id in requested_subjects:
		if not selected.has(str(subject_id)):
			selected.append(str(subject_id))
	var message := _validate_subject_choices(selected, curriculum, data)
	if not message.is_empty():
		return _failure("education_subjects_invalid", message)
	record.subject_ids = selected
	_add_event(record, "subject_choices_updated", day, {"subject_count": selected.size()})
	sync_legacy_character(character)
	return _success(
		"education_subjects_updated", "Your optional subjects were updated for the current year."
	)


static func choose_elective(character: Object, subject_id: String, day: int) -> Dictionary:
	var record := ensure_character_record(character, day)
	var data := catalog()
	var curriculum := _curriculum_for(record, data)
	var group: Dictionary = {}
	for group_value in curriculum.get("elective_groups", []):
		if group_value.get("subject_ids", []).has(subject_id):
			group = group_value
			break
	if group.is_empty():
		return _failure(
			"education_elective_unavailable",
			"That subject is not part of a configured elective group."
		)
	var chosen_in_group: Array[String] = []
	for selected in record.get("subject_ids", []):
		if group.get("subject_ids", []).has(str(selected)):
			chosen_in_group.append(str(selected))
	if chosen_in_group.has(subject_id):
		return _failure("education_elective_selected", "That subject is already selected.")
	var next_subjects: Array[String] = []
	for selected in record.get("subject_ids", []):
		if not chosen_in_group.has(str(selected)):
			next_subjects.append(str(selected))
	if chosen_in_group.size() >= int(group.get("maximum_choices", 1)):
		chosen_in_group.pop_back()
	for selected in chosen_in_group:
		next_subjects.append(selected)
	next_subjects.append(subject_id)
	var validation := _validate_subject_choices(next_subjects, curriculum, data)
	if not validation.is_empty():
		return _failure("education_subjects_invalid", validation)
	record.subject_ids = next_subjects
	_add_event(
		record,
		"elective_subject_selected",
		day,
		{"subject_id": subject_id, "group_id": group.get("id", "")}
	)
	sync_legacy_character(character)
	return _success(
		"education_subjects_updated",
		"You selected %s as an optional subject." % _subject_name(subject_id, data)
	)


static func _validate_subject_choices(
	selected: Array[String], curriculum: Dictionary, data: Dictionary
) -> String:
	if selected.size() > int(curriculum.get("maximum_subject_count", 0)):
		return "The selected subject list is above the configured maximum."
	for subject_id in selected:
		if _find_by_id(data.get("subjects", []), subject_id).is_empty():
			return "The selected subjects must exist in the current curriculum."
	for required_id in curriculum.get("compulsory_subject_ids", []):
		if not selected.has(str(required_id)):
			return "Keep all compulsory subjects in your selection."
	for group in curriculum.get("elective_groups", []):
		var count := 0
		for subject_id in selected:
			if group.get("subject_ids", []).has(subject_id):
				count += 1
		if (
			count < int(group.get("minimum_choices", 0))
			or count > int(group.get("maximum_choices", 0))
		):
			return (
				"Choose the configured number of subjects in %s."
				% str(group.get("id", "this elective group"))
			)
	return ""


static func _charge_education_cost(character: Object, amount: int) -> bool:
	if amount < 0:
		return false
	var record_value: Variant = character.get("education_record")
	if not record_value is Dictionary:
		return false
	var record: Dictionary = record_value
	var available_awards := 0
	for award in record.get("scholarships", []):
		if str(award.get("status", "")) == "awarded":
			available_awards += int(award.get("funding_balance_ngn", 0))
	if int(character.get("money")) + available_awards < amount:
		return false
	var remainder := amount
	for award in record.get("scholarships", []):
		if str(award.get("status", "")) != "awarded" or remainder <= 0:
			continue
		var used := mini(remainder, int(award.get("funding_balance_ngn", 0)))
		award.funding_balance_ngn = int(award.get("funding_balance_ngn", 0)) - used
		remainder -= used
		if int(award.funding_balance_ngn) <= 0:
			award.status = "exhausted"
	character.set("money", int(character.get("money")) - remainder)
	return true


static func _advance_scholarship_term(record: Dictionary, day: int) -> void:
	for award in record.get("scholarships", []):
		if str(award.get("status", "")) != "awarded":
			continue
		award.remaining_terms = maxi(
			0, int(award.get("remaining_terms", award.get("duration_terms", 1))) - 1
		)
		if int(award.remaining_terms) == 0:
			award.status = "expired"
			award.funding_balance_ngn = 0
			_add_event(
				record,
				"scholarship_period_expired",
				day,
				{"scholarship_id": award.get("scholarship_id", "")}
			)


static func pay_school_fees(character: Object, day: int) -> Dictionary:
	var record := ensure_character_record(character, day)
	var data := catalog()
	var school := _find_by_id(data.get("institutions", []), str(record.school_id))
	var key := "school_fees_paid:%d:%d" % [int(record.academic_year), int(record.term)]
	for event in record.education_events:
		if str(event.get("type", "")) == key:
			return _failure(
				"education_fees_already_paid",
				"School fees for this term are already recorded as paid."
			)
	var tuition := ceili(
		(
			float(school.get("annual_fee_ngn", 0))
			/ float(maxi(1, int(data.get("calendar", {}).get("terms_per_academic_year", 3))))
		)
	)
	var amount := tuition
	if int(record.academic_year) == 1 and int(record.term) == 1:
		amount += int(data.get("education_costs", {}).get("books_and_materials_ngn", 0))
	if not _charge_education_cost(character, amount):
		return _failure(
			"insufficient_funds",
			"This term's configured school and materials cost is ₦%d." % amount
		)
	_add_event(record, key, day, {"amount_ngn": amount, "school_id": record.school_id})
	character.call("touch")
	return _success(
		"education_fees_paid",
		"You paid ₦%d toward the configured school term and materials." % amount
	)


static func register_final_exam(
	character: Object, selected_subjects: Array, day: int
) -> Dictionary:
	var record := ensure_character_record(character, day)
	var data := catalog()
	var exam: Dictionary = data.get("final_examination", {})
	if (
		str(record.get("progression_status", "")) != "final_exam_eligible"
		or str(record.get("current_class_id", "")) != "SS3"
	):
		return _failure(
			"education_final_exam_not_eligible",
			"Complete SS 3 before registering for the senior certificate examination."
		)
	if _has_active_registration(record):
		return _failure(
			"education_final_exam_already_registered",
			"An examination registration is already in progress."
		)
	var selected: Array[String] = []
	for subject_id in selected_subjects:
		if not selected.has(str(subject_id)):
			selected.append(str(subject_id))
	if selected.size() < int(exam.get("minimum_subjects", 5)):
		return _failure(
			"education_final_exam_subjects_invalid",
			"Choose at least %d subjects." % int(exam.get("minimum_subjects", 5))
		)
	for subject_id in selected:
		if not record.subject_ids.has(subject_id):
			return _failure(
				"education_final_exam_subjects_invalid",
				"The examination subject list must come from your current courses."
			)
	for required_id in exam.get("required_credit_subject_ids", []):
		if not selected.has(str(required_id)):
			return _failure(
				"education_final_exam_subjects_invalid",
				"Your current course list must include the required core examination subjects."
			)
	var fee := (
		int(exam.get("retake_fee_ngn", 0))
		if not record.final_exam_registrations.is_empty()
		else int(exam.get("registration_fee_ngn", 0))
	)
	if not _charge_education_cost(character, fee):
		return _failure("insufficient_funds", "Examination registration costs ₦%d." % fee)
	var registration := {
		"registration_id": _new_id("final-registration"),
		"examination_id": str(exam.get("id", "naija-senior-certificate-v1")),
		"registered_day": day,
		"subjects": selected,
		"status": "registered",
		"certificate_eligible": false,
	}
	record.final_exam_registrations.append(registration)
	_add_event(
		record,
		"final_exam_registered",
		day,
		{"registration_id": registration.registration_id, "subject_count": selected.size()}
	)
	return _success(
		"education_final_exam_registered",
		(
			"%s registration is saved. Papers open on the next game day."
			% str(exam.get("name", "Senior certificate examination"))
		)
	)


static func next_final_exam_question(character: Object, day: int) -> Dictionary:
	var record := ensure_character_record(character, day)
	var registration: Dictionary = {}
	for index in range(record.final_exam_registrations.size() - 1, -1, -1):
		var candidate: Dictionary = record.final_exam_registrations[index]
		if str(candidate.get("status", "")) != "results_published":
			registration = candidate
			break
	if registration.is_empty():
		return {}
	var data := catalog()
	if (
		day
		< (
			int(registration.get("registered_day", day))
			+ int(data.get("final_examination", {}).get("exam_days_after_registration", 1))
		)
	):
		return {}
	for subject_id in registration.get("subjects", []):
		var attempted := false
		for attempt in record.final_exam_attempts:
			if (
				(
					str(attempt.get("registration_id", ""))
					== str(registration.get("registration_id", ""))
				)
				and str(attempt.get("subject_id", "")) == str(subject_id)
			):
				attempted = true
				break
		if attempted:
			continue
		for question in data.get("questions", []):
			if (
				str(question.get("subject_id", "")) == str(subject_id)
				and question.get("class_ids", []).has("SS3")
			):
				return {
					"registration": registration,
					"registration_id": registration.registration_id,
					"subject_id": str(subject_id),
					"question": question
				}
	return {}


static func answer_final_exam(
	character: Object,
	registration_id: String,
	subject_id: String,
	question_id: String,
	answer_index: int,
	day: int
) -> Dictionary:
	var record := ensure_character_record(character, day)
	var next := next_final_exam_question(character, day)
	if (
		next.is_empty()
		or str(next.get("registration_id", "")) != registration_id
		or str(next.get("subject_id", "")) != subject_id
	):
		return _failure(
			"education_final_exam_answer_invalid",
			"That exam response is invalid or already recorded."
		)
	var question: Dictionary = next.get("question", {})
	if (
		str(question.get("id", "")) != question_id
		or answer_index < 0
		or answer_index >= question.get("choices", []).size()
	):
		return _failure("education_final_exam_answer_invalid", "That exam response is invalid.")
	var data := catalog()
	var score := 100 if answer_index == int(question.get("correct_choice_index", -1)) else 0
	var attempt := {
		"attempt_id": _new_id("final-attempt"),
		"registration_id": registration_id,
		"subject_id": subject_id,
		"day": day,
		"score": score,
		"grade": str(_grade_for_score(score, data).grade),
		"credit": score >= int(data.get("final_examination", {}).get("pass_score", 50)),
		"question_id": question_id,
	}
	record.final_exam_attempts.append(attempt)
	_add_assessment(record, subject_id, "examination", score, question_id, "final_exam", day)
	var registration_index := -1
	for index in range(record.final_exam_registrations.size()):
		if (
			str(record.final_exam_registrations[index].get("registration_id", ""))
			== registration_id
		):
			registration_index = index
			break
	if registration_index >= 0:
		record.final_exam_registrations[registration_index].status = "in_progress"
	var result_status := _publish_final_exam_results(record, registration_id, day, data)
	sync_legacy_character(character)
	return {
		"ok": true,
		"code": "education_final_exam_result",
		"message": "Your %s paper was recorded." % _subject_name(subject_id, data),
		"attempt": attempt,
		"certificate_eligible": result_status
	}


static func _publish_final_exam_results(
	record: Dictionary, registration_id: String, day: int, data: Dictionary
) -> Variant:
	var registration_index := -1
	for index in range(record.final_exam_registrations.size()):
		if (
			str(record.final_exam_registrations[index].get("registration_id", ""))
			== registration_id
		):
			registration_index = index
			break
	if registration_index < 0:
		return null
	var registration: Dictionary = record.final_exam_registrations[registration_index]
	var attempts: Array = []
	for attempt in record.final_exam_attempts:
		if str(attempt.get("registration_id", "")) == registration_id:
			attempts.append(attempt)
	for subject_id in registration.get("subjects", []):
		var found := false
		for attempt in attempts:
			if str(attempt.get("subject_id", "")) == str(subject_id):
				found = true
				break
		if not found:
			return null
	var credits: Array[String] = []
	for attempt in attempts:
		if bool(attempt.get("credit", false)):
			credits.append(str(attempt.get("subject_id", "")))
	var exam: Dictionary = data.get("final_examination", {})
	var eligible := credits.size() >= int(exam.get("minimum_credits", 5))
	for required_id in exam.get("required_credit_subject_ids", []):
		if not credits.has(str(required_id)):
			eligible = false
	record.final_exam_registrations[registration_index].status = "results_published"
	record.final_exam_registrations[registration_index].certificate_eligible = eligible
	if eligible and not _has_qualification(record, "qualification:secondary-school-certificate"):
		var school := _find_by_id(data.get("institutions", []), str(record.get("school_id", "")))
		(
			record
			. qualifications
			. append(
				{
					"id": "qualification:secondary-school-certificate",
					"name": "Senior secondary completion certificate",
					"award": "Secondary certificate (fictional game award)",
					"institution_id": str(school.get("id", record.school_id)),
					"completed_day": day,
					"career_links": [],
				}
			)
		)
		record.progression_status = "secondary_complete"
		record.enrollment_status = "completed"
	_add_event(
		record,
		"final_exam_results_published",
		day,
		{
			"registration_id": registration_id,
			"credits": credits.size(),
			"certificate_eligible": eligible
		}
	)
	return eligible


static func apply_program(
	character: Object, program_id: String, day: int, seats_used: int = 0
) -> Dictionary:
	var record := ensure_character_record(character, day)
	var data := catalog()
	var program := _find_by_id(data.get("programs", []), program_id)
	if program.is_empty():
		return _failure("education_program_unavailable", "That education program is not available.")
	var fee := int(program.get("application_fee_ngn", 0))
	if not _charge_education_cost(character, fee):
		return _failure("insufficient_funds", "The application fee is ₦%d." % fee)
	var reason := _program_ineligibility(character, program, record)
	var status := (
		"rejected"
		if not reason.is_empty()
		else ("waitlisted" if seats_used >= int(program.get("capacity", 0)) else "offered")
	)
	if reason.is_empty() and status == "waitlisted":
		reason = "The prototype program intake is currently full."
	elif reason.is_empty():
		reason = "Entry checks passed. Accept or decline this offer."
	var application := {
		"application_id": _new_id("application"),
		"program_id": program_id,
		"institution_id": str(program.get("institution_id", "")),
		"submitted_day": day,
		"status": status,
		"decision_reason": reason,
	}
	record.admission_applications.append(application)
	_add_event(
		record, "admission_application_decided", day, {"program_id": program_id, "status": status}
	)
	return {
		"ok": true,
		"code": "education_application_decided",
		"message": "Application status: %s. %s" % [status.capitalize(), reason],
		"application": application
	}


static func respond_to_offer(
	character: Object, application_id: String, accept: bool, day: int
) -> Dictionary:
	var record := ensure_character_record(character, day)
	var application: Dictionary = {}
	for item in record.admission_applications:
		if str(item.get("application_id", "")) == application_id:
			application = item
			break
	if application.is_empty() or str(application.get("status", "")) != "offered":
		return _failure("education_offer_unavailable", "That admission offer is not available.")
	if not accept:
		application.status = "declined"
		_add_event(record, "admission_offer_declined", day, {"program_id": application.program_id})
		return _success(
			"education_offer_declined",
			"You declined the offer. Other education routes remain available."
		)
	var data := catalog()
	var program := _find_by_id(data.get("programs", []), str(application.get("program_id", "")))
	var cost := (
		int(program.get("registration_fee_ngn", 0)) + int(program.get("tuition_per_term_ngn", 0))
	)
	if not _charge_education_cost(character, cost):
		return _failure(
			"insufficient_funds",
			(
				"First-term enrollment costs ₦%d. Apply for support or choose a lower-cost route."
				% cost
			)
		)
	application.status = "accepted"
	record.tertiary_enrollment = {
		"institution_id": str(program.get("institution_id", "")),
		"program_id": str(program.get("id", "")),
		"program_kind": str(program.get("kind", "university")),
		"award": str(program.get("award", "Certificate")),
		"semester": 1,
		"duration_semesters": int(program.get("duration_semesters", 1)),
		"semester_start_day": day,
		"status": "active",
		"course_ids": program.get("course_ids", []).duplicate(),
		"course_scores": {},
	}
	record.progression_status = "tertiary_active"
	_add_event(
		record,
		"tertiary_enrollment_started",
		day,
		{"program_id": program.id, "award": program.award}
	)
	sync_legacy_character(character)
	return _success(
		"education_enrolled",
		(
			"You enrolled in %s (%s)."
			% [str(program.get("name", "Program")), str(program.get("award", "qualification"))]
		)
	)


static func begin_tertiary_course(character: Object) -> Dictionary:
	var record: Dictionary = character.get("education_record", {})
	var enrollment: Variant = record.get("tertiary_enrollment", null)
	if not enrollment is Dictionary or str(enrollment.get("status", "")) == "completed":
		return {}
	var data := catalog()
	for course_id in enrollment.get("course_ids", []):
		var course := _find_by_id(data.get("courses", []), str(course_id))
		var scores: Array = enrollment.get("course_scores", {}).get(str(course_id), [])
		if scores.size() >= int(enrollment.get("semester", 1)):
			continue
		var question := _find_by_id(data.get("questions", []), str(course.get("question_id", "")))
		if course.is_empty() or question.is_empty():
			continue
		return {
			"course": course, "question": question, "subject_id": str(course.get("subject_id", ""))
		}
	return {}


static func record_tertiary_answer(
	character: Object, course_id: String, answer_index: int, day: int
) -> Dictionary:
	var record: Dictionary = character.get("education_record", {})
	var enrollment: Variant = record.get("tertiary_enrollment", null)
	var data := catalog()
	if not enrollment is Dictionary or str(enrollment.get("status", "")) == "completed":
		return _failure("education_not_enrolled", "There is no active tertiary course.")
	var course := _find_by_id(data.get("courses", []), course_id)
	var question := _find_by_id(data.get("questions", []), str(course.get("question_id", "")))
	if (
		course.is_empty()
		or question.is_empty()
		or answer_index < 0
		or answer_index >= question.get("choices", []).size()
	):
		return _failure("education_course_answer_invalid", "That course response is invalid.")
	var score := 90 if answer_index == int(question.get("correct_choice_index", -1)) else 40
	var course_scores: Dictionary = enrollment.get("course_scores", {})
	var scores: Array = course_scores.get(course_id, [])
	scores.append(score)
	course_scores[course_id] = scores
	enrollment.course_scores = course_scores
	_add_assessment(
		record,
		str(course.subject_id),
		str(course.assessment_type),
		score,
		str(question.id),
		"tertiary_course",
		day
	)
	_add_event(
		record,
		"tertiary_course_assessed",
		day,
		{"course_id": course_id, "score": score, "semester": enrollment.semester}
	)
	sync_legacy_character(character)
	return _success("education_course_assessed", "Course assessment recorded: %d%%." % score)


static func close_tertiary_semester(character: Object, day: int) -> Dictionary:
	var record := ensure_character_record(character, day)
	var enrollment: Variant = record.get("tertiary_enrollment", null)
	if not enrollment is Dictionary or str(enrollment.get("status", "")) == "completed":
		return _failure("education_not_enrolled", "There is no active tertiary program to close.")
	var data := catalog()
	var calendar: Dictionary = data.get("tertiary_calendar", {})
	if (
		day
		< (
			int(enrollment.get("semester_start_day", day))
			+ int(calendar.get("term_length_game_days", 5))
		)
	):
		return _failure("education_semester_not_due", "The semester period is still in progress.")
	var course_ids: Array = enrollment.get("course_ids", [])
	var course_scores: Dictionary = enrollment.get("course_scores", {})
	var semester := int(enrollment.get("semester", 1))
	for course_id in course_ids:
		if course_scores.get(str(course_id), []).size() < semester:
			return _failure(
				"education_course_results_incomplete",
				"Complete an assessment in every program course before closing the semester."
			)
	var total := 0.0
	for course_id in course_ids:
		total += float(course_scores.get(str(course_id), [0]).back())
	var average := roundi(total / float(maxi(1, course_ids.size())))
	var program := _find_by_id(data.get("programs", []), str(enrollment.get("program_id", "")))
	if program.is_empty():
		return _failure(
			"education_program_unavailable", "The enrolled program is missing from the catalog."
		)
	var tuition := int(program.get("tuition_per_term_ngn", 0))
	if average < int(calendar.get("good_standing_average", 50)):
		if not _charge_education_cost(character, tuition):
			return _failure("insufficient_funds", "Repeating this semester requires ₦%d." % tuition)
		for course_id in course_ids:
			var scores: Array = course_scores.get(str(course_id), [])
			if scores.size() >= semester:
				scores.resize(semester - 1)
				course_scores[str(course_id)] = scores
		enrollment.course_scores = course_scores
		enrollment.status = "probation"
		enrollment.semester_start_day = day
		_add_event(
			record, "tertiary_academic_warning", day, {"semester": semester, "average": average}
		)
		_advance_scholarship_term(record, day)
		return _success(
			"education_academic_warning",
			(
				"Academic warning: %d%% is below the configured progression threshold. Repeat tuition was paid."
				% average
			)
		)
	if semester < int(enrollment.get("duration_semesters", 1)):
		if not _charge_education_cost(character, tuition):
			return _failure("insufficient_funds", "The next semester requires ₦%d." % tuition)
		enrollment.semester = semester + 1
		enrollment.semester_start_day = day
		enrollment.status = "active"
		_add_event(
			record,
			"tertiary_semester_completed",
			day,
			{"completed_semester": semester, "average": average}
		)
		_advance_scholarship_term(record, day)
		return _success(
			"education_semester_advanced",
			"Semester %d is open. Course average: %d%%; tuition paid." % [semester + 1, average]
		)
	enrollment.status = "completed"
	_advance_scholarship_term(record, day)
	record.progression_status = "tertiary_complete"
	var qualification_id := "qualification:" + str(program.get("id", ""))
	if not _has_qualification(record, qualification_id):
		(
			record
			. qualifications
			. append(
				{
					"id": qualification_id,
					"name": str(program.get("name", "Tertiary program")),
					"award": str(program.get("award", "Tertiary award")),
					"institution_id": str(program.get("institution_id", "")),
					"completed_day": day,
					"career_links": program.get("career_links", []).duplicate(),
				}
			)
		)
	_add_event(
		record,
		"tertiary_qualification_awarded",
		day,
		{"program_id": program.get("id", ""), "award": program.get("award", "")}
	)
	sync_legacy_character(character)
	return _success(
		"education_program_completed",
		(
			(
				"You completed %s and earned %s. Career eligibility is recorded; "
				+ "employment is not part of this stage."
			)
			% [
				str(program.get("name", "the program")),
				str(program.get("award", "a qualification"))
			]
		)
	)


static func enroll_training(
	character: Object, training_id: String, apprenticeship: bool, day: int
) -> Dictionary:
	var record := ensure_character_record(character, day)
	var data := catalog()
	var training := _find_by_id(data.get("training_programs", []), training_id)
	if training.is_empty():
		return _failure("education_training_unavailable", "That training program is not available.")
	for enrollment in record.vocational_enrollments:
		if str(enrollment.get("status", "")) == "active":
			return _failure(
				"education_training_already_active",
				"Complete or leave your current training before starting another."
			)
	for record_value in record.apprenticeships:
		if str(record_value.get("status", "")) == "active":
			return _failure(
				"education_training_already_active",
				"Complete or leave your current training before starting another."
			)
	if apprenticeship:
		var defaults: Dictionary = data.get("apprenticeship_defaults", {})
		var apprenticeship_record := {
			"apprenticeship_id": _new_id("apprenticeship"),
			"training_program_id": training_id,
			"skill_id": str(training.get("skill_id", "")),
			"master_teacher_id": str(training.get("master_teacher_id", "")),
			"started_day": day,
			"sessions_completed": 0,
			"required_sessions":
			maxi(
				int(defaults.get("minimum_sessions", 1)), int(training.get("duration_sessions", 1))
			),
			"status": "active",
			"skill_level": 0,
		}
		record.apprenticeships.append(apprenticeship_record)
		_add_event(
			record,
			"apprenticeship_started",
			day,
			{
				"training_program_id": training_id,
				"master_teacher_id": training.get("master_teacher_id", "")
			}
		)
		return _success(
			"education_apprenticeship_started",
			(
				"You began %s with a named community mentor."
				% str(training.get("name", "an apprenticeship"))
			)
		)
	var enrollment := {
		"enrollment_id": _new_id("vocational-enrollment"),
		"training_program_id": training_id,
		"institution_id": str(training.get("institution_id", "")),
		"started_day": day,
		"sessions_completed": 0,
		"duration_sessions": int(training.get("duration_sessions", 1)),
		"status": "active",
		"skill_id": str(training.get("skill_id", "")),
	}
	record.vocational_enrollments.append(enrollment)
	record.progression_status = "vocational_active"
	_add_event(
		record,
		"vocational_training_started",
		day,
		{"training_program_id": training_id, "skill_id": training.get("skill_id", "")}
	)
	return _success(
		"education_training_enrolled",
		(
			"You enrolled in %s. Each practical session costs ₦%d."
			% [
				str(training.get("name", "skills training")),
				int(training.get("session_cost_ngn", 0))
			]
		)
	)


static func practice_training(character: Object, day: int, location: String) -> Dictionary:
	if location != "training_center":
		return _failure(
			"education_training_location_required",
			"Travel to the community skills centre before practising."
		)
	var record := ensure_character_record(character, day)
	var enrollment: Dictionary = {}
	var apprenticeship: Dictionary = {}
	for item in record.vocational_enrollments:
		if str(item.get("status", "")) == "active":
			enrollment = item
			break
	for item in record.apprenticeships:
		if str(item.get("status", "")) == "active":
			apprenticeship = item
			break
	if enrollment.is_empty() and apprenticeship.is_empty():
		return _failure(
			"education_training_not_enrolled", "Choose a vocational course or apprenticeship first."
		)
	var training_id := str(
		enrollment.get("training_program_id", apprenticeship.get("training_program_id", ""))
	)
	var data := catalog()
	var training := _find_by_id(data.get("training_programs", []), training_id)
	var fee := int(training.get("session_cost_ngn", 0))
	if not _charge_education_cost(character, fee):
		return _failure("insufficient_funds", "This practical session costs ₦%d." % fee)
	character.set("energy", maxf(0.0, float(character.get("energy")) - 2.0))
	var required := int(
		apprenticeship.get(
			"required_sessions",
			enrollment.get("duration_sessions", training.get("duration_sessions", 1))
		)
	)
	var completed := (
		int(apprenticeship.get("sessions_completed", enrollment.get("sessions_completed", 0))) + 1
	)
	if not enrollment.is_empty():
		enrollment.sessions_completed = completed
	if not apprenticeship.is_empty():
		apprenticeship.sessions_completed = completed
		apprenticeship.skill_level = minf(
			float(data.get("apprenticeship_defaults", {}).get("completion_skill_level", 1)),
			float(completed) / float(maxi(1, required))
		)
	var skill_id := str(training.get("skill_id", ""))
	var skill := _add_skill_experience(record, skill_id, 25, training.get("career_links", []))
	var complete := completed >= required
	if complete:
		if not enrollment.is_empty():
			enrollment.status = "completed"
		if not apprenticeship.is_empty():
			apprenticeship.status = "completed"
		var qualification_id := "qualification:" + training_id
		if not _has_qualification(record, qualification_id):
			(
				record
				. qualifications
				. append(
					{
						"id": qualification_id,
						"name":
						str(training.get("certificate_name", "Community skills certificate")),
						"award": "Prototype community skills certificate",
						"institution_id": str(training.get("institution_id", "")),
						"completed_day": day,
						"career_links": training.get("career_links", []).duplicate(),
					}
				)
			)
		skill.certificate_ids.append("certificate:" + training_id)
		var tertiary_enrollment: Variant = record.get("tertiary_enrollment", null)
		var tertiary_still_active := (
			tertiary_enrollment is Dictionary
			and str(tertiary_enrollment.get("status", "")) != "completed"
		)
		var secondary_certificate_earned := _has_qualification(
			record, "qualification:secondary-school-certificate"
		)
		record.progression_status = (
			"tertiary_active"
			if tertiary_still_active
			else "secondary_complete" if secondary_certificate_earned else "active"
		)
	_add_event(
		record,
		"training_completed" if complete else "training_session_completed",
		day,
		{"training_program_id": training_id, "sessions_completed": completed, "skill_id": skill_id}
	)
	sync_legacy_character(character)
	return {
		"ok": true,
		"code": "education_training_completed" if complete else "education_training_progressed",
		"message":
		(
			"%s: %d/%d practical sessions complete."
			% [str(training.get("name", "Training")), completed, required]
		),
		"skill": skill
	}


static func apply_scholarship(character: Object, scholarship_id: String, day: int) -> Dictionary:
	var record := ensure_character_record(character, day)
	var data := catalog()
	var scholarship := _find_by_id(data.get("scholarships", []), scholarship_id)
	if scholarship.is_empty():
		return _failure("education_scholarship_unavailable", "That study award is not available.")
	for award in record.scholarships:
		if (
			str(award.get("scholarship_id", "")) == scholarship_id
			and str(award.get("status", "")) == "awarded"
		):
			return _failure("education_scholarship_exists", "You already hold this award.")
	var average := _current_average(record)
	if average < float(scholarship.get("minimum_secondary_average", 0)):
		return _failure(
			"education_scholarship_ineligible",
			(
				"The current prototype award threshold is %d%%."
				% int(scholarship.get("minimum_secondary_average", 0))
			)
		)
	var max_money: Variant = scholarship.get("maximum_money_ngn", null)
	if max_money != null and int(character.get("money")) > int(max_money):
		return _failure(
			"education_scholarship_ineligible",
			"This community bursary is for students who meet its configured financial-need threshold."
		)
	var award := {
		"scholarship_id": scholarship_id,
		"name": str(scholarship.get("name", "Study award")),
		"kind": str(scholarship.get("kind", "merit")),
		"awarded_day": day,
		"funding_balance_ngn": int(scholarship.get("award_amount_ngn", 0)),
		"duration_terms": int(scholarship.get("duration_terms", 1)),
		"remaining_terms": int(scholarship.get("duration_terms", 1)),
		"status": "awarded",
	}
	record.scholarships.append(award)
	_add_event(
		record,
		"scholarship_awarded",
		day,
		{"scholarship_id": scholarship_id, "funding_ngn": award.funding_balance_ngn}
	)
	return _success(
		"education_scholarship_awarded",
		"%s added ₦%d to your education funding." % [award.name, award.funding_balance_ngn]
	)


static func request_family_support(character: Object, day: int, location: String) -> Dictionary:
	var record := ensure_character_record(character, day)
	var data := catalog()
	if location != "home":
		return _failure(
			"education_family_support_location_required",
			"Speak with your family at home about study costs."
		)
	var guardians: Variant = character.get("household", {}).get("guardians", [])
	if (
		not guardians is Array
		or guardians.size() < int(data.get("family_support", {}).get("minimum_guardians", 1))
	):
		return _failure(
			"education_family_support_unavailable",
			"Family support is not available for this request."
		)
	if (
		int(character.get("money"))
		> int(data.get("family_support", {}).get("eligibility_maximum_player_balance_ngn", 0))
	):
		return _failure(
			"education_family_support_unavailable",
			"Your current balance is above the configured need threshold."
		)
	for claim in record.family_support_claims:
		if (
			int(claim.get("academic_year", -1)) == int(record.academic_year)
			and int(claim.get("term", -1)) == int(record.term)
		):
			return _failure(
				"education_family_support_already_used",
				"Family support has already been requested for this term."
			)
	var amount := int(data.get("family_support", {}).get("support_amount_ngn", 0))
	character.set("money", int(character.get("money")) + amount)
	record.family_support_claims.append(
		{
			"academic_year": record.academic_year,
			"term": record.term,
			"amount_ngn": amount,
			"day": day
		}
	)
	_add_event(record, "family_study_support_received", day, {"amount_ngn": amount})
	return _success(
		"education_family_support_received",
		"Your guardians helped with ₦%d toward study costs." % amount
	)


static func attend_activity(
	character: Object, activity_id: String, day: int, minute_of_day: int, location: String
) -> Dictionary:
	var record := ensure_character_record(character, day)
	var entry := current_activity(record, day, minute_of_day, location)
	if entry.is_empty() or str(entry.get("activity_id", "")) != activity_id:
		return _failure(
			"education_activity_not_in_session",
			"That activity is not happening at this game time and location."
		)
	var activity := _find_by_id(catalog().get("activities", []), activity_id)
	if activity.is_empty():
		return _failure("education_activity_unavailable", "That school activity is not available.")
	for existing in record.get("attendance_records", []):
		if (
			int(existing.get("day", 0)) == day
			and str(existing.get("schedule_id", "")) == str(entry.get("id", ""))
		):
			return _failure(
				"education_activity_already_attended",
				"This scheduled activity has already been recorded today."
			)
	var attendance := record_attendance(record, entry, day, minute_of_day)
	if str(attendance.get("status", "")) == "absent":
		return _failure(
			"education_activity_missed", "This activity has already been recorded as missed today."
		)
	character.set(
		"energy", maxf(0.0, float(character.get("energy")) - float(activity.get("energy_cost", 0)))
	)
	character.set(
		"reputation",
		mini(100, int(character.get("reputation")) + int(activity.get("relationship_bonus", 0)))
	)
	_add_event(
		record,
		"school_activity_completed",
		day,
		{"activity_id": activity_id, "kind": activity.get("kind", "club")}
	)
	return _success(
		"education_activity_completed",
		"You joined %s and connected with classmates." % str(activity.get("name", "the activity"))
	)


static func apply_action(
	character: Object,
	action: String,
	payload: Dictionary,
	day: int,
	minute_of_day: int,
	location: String
) -> Dictionary:
	var result: Dictionary = {}
	match action:
		"choose_subjects":
			var requested: Variant = payload.get("subject_ids", [])
			result = choose_subjects(character, requested if requested is Array else [], day)
		"choose_elective":
			result = choose_elective(character, str(payload.get("subject_id", "")), day)
		"close_term":
			result = close_current_term(character, day)
		"choose_progression":
			result = choose_progression(character, str(payload.get("choice", "")), day)
		"pay_school_fees":
			result = pay_school_fees(character, day)
		"register_final_exam":
			var subjects: Variant = payload.get("subject_ids", [])
			result = register_final_exam(character, subjects if subjects is Array else [], day)
		"apply_program":
			result = apply_program(character, str(payload.get("program_id", "")), day)
		"respond_application":
			result = respond_to_offer(
				character,
				str(payload.get("application_id", "")),
				bool(payload.get("accept", false)),
				day
			)
		"close_tertiary_semester":
			result = close_tertiary_semester(character, day)
		"enroll_training":
			result = enroll_training(
				character, str(payload.get("training_program_id", "")), false, day
			)
		"enroll_apprenticeship":
			result = enroll_training(
				character, str(payload.get("training_program_id", "")), true, day
			)
		"practice_training":
			result = practice_training(character, day, location)
		"apply_scholarship":
			result = apply_scholarship(character, str(payload.get("scholarship_id", "")), day)
		"family_support":
			result = request_family_support(character, day, location)
		"attend_activity":
			result = attend_activity(
				character, str(payload.get("activity_id", "")), day, minute_of_day, location
			)
		_:
			result = _failure("education_action_unknown", "That education action is not available.")
	if bool(result.get("ok", false)):
		character.call("touch")
		sync_legacy_character(character)
	return result


static func _program_ineligibility(
	character: Object, program: Dictionary, record: Dictionary
) -> String:
	if int(character.get("age")) < int(program.get("minimum_age", 0)):
		return "This program currently requires age %d." % int(program.get("minimum_age", 0))
	var requirements: Dictionary = program.get("requirements", {})
	var credits := _latest_final_exam_credits(record)
	if credits.size() < int(requirements.get("minimum_final_credits", 0)):
		return "Complete enough senior-exam credits first."
	for subject_id in requirements.get("required_subject_ids", []):
		if not credits.has(str(subject_id)):
			return "A required subject credit is missing."
	if _current_average(record) < float(requirements.get("minimum_secondary_average", 0)):
		return "Your latest academic average is below this prototype entry requirement."
	for qualification_id in requirements.get("required_qualification_ids", []):
		if not _has_qualification(record, str(qualification_id)):
			return "A prerequisite qualification is missing."
	return ""


static func _latest_final_exam_credits(record: Dictionary) -> Array[String]:
	var registration: Dictionary = {}
	for index in range(record.get("final_exam_registrations", []).size() - 1, -1, -1):
		var candidate: Dictionary = record.final_exam_registrations[index]
		if str(candidate.get("status", "")) == "results_published":
			registration = candidate
			break
	var result: Array[String] = []
	if registration.is_empty():
		return result
	for attempt in record.get("final_exam_attempts", []):
		if (
			str(attempt.get("registration_id", "")) == str(registration.get("registration_id", ""))
			and bool(attempt.get("credit", false))
		):
			result.append(str(attempt.get("subject_id", "")))
	return result


static func _current_average(record: Dictionary) -> float:
	var results: Array = record.get("term_results", [])
	if not results.is_empty():
		var latest: Dictionary = results.back()
		return float(latest.get("overall_average", 0))
	var data := catalog()
	var attendance := int(
		(
			attendance_summary(
				record, int(record.get("academic_year", 1)), int(record.get("term", 1))
			)
			. percent
		)
	)
	var total := 0.0
	var count := 0
	for subject_id in record.get("subject_ids", []):
		total += _subject_score(record, str(subject_id), data, attendance)
		count += 1
	return total / float(maxi(1, count))


static func _subject_score(
	record: Dictionary, subject_id: String, data: Dictionary, attendance_percent: int
) -> int:
	var grading: Dictionary = data.get("grading", {})
	var entries: Array = []
	for entry in record.get("assessment_records", []):
		if (
			int(entry.get("academic_year", -1)) == int(record.get("academic_year", 1))
			and int(entry.get("term", -1)) == int(record.get("term", 1))
			and str(entry.get("subject_id", "")) == subject_id
		):
			entries.append(entry)
	var totals: Dictionary = {}
	for entry in entries:
		var category := str(entry.get("assessment_type", ""))
		var bucket: Dictionary = totals.get(category, {"sum": 0.0, "count": 0})
		bucket.sum = (
			float(bucket.sum)
			+ (
				float(entry.get("score", 0))
				/ maxf(1.0, float(entry.get("maximum_score", 100)))
				* 100.0
			)
		)
		bucket.count = int(bucket.count) + 1
		totals[category] = bucket
	var weights: Dictionary = grading.get("assessment_weights", {})
	var weighted_total := 0.0
	var total_weight := 0.0
	for category in totals:
		var weight := float(weights.get(category, 0.0))
		if weight <= 0.0:
			continue
		var bucket: Dictionary = totals[category]
		weighted_total += float(bucket.sum) / float(bucket.count) * weight
		total_weight += weight
	var academic_score := 0.0
	var count := 0
	if total_weight > 0.0:
		academic_score = weighted_total / total_weight
	else:
		for entry in record.get("assessment_records", []):
			if str(entry.get("subject_id", "")) == subject_id:
				academic_score += (
					float(entry.get("score", 0))
					/ maxf(1.0, float(entry.get("maximum_score", 100)))
					* 100.0
				)
				count += 1
		if count > 0:
			academic_score /= float(count)
	var attendance_weight := float(grading.get("attendance_weight", 0.0))
	return clampi(
		roundi(
			(
				academic_score * (1.0 - attendance_weight)
				+ float(attendance_percent) * attendance_weight
			)
		),
		0,
		100
	)


static func _grade_for_score(score: float, data: Dictionary) -> Dictionary:
	var bands: Array = data.get("grading", {}).get("grade_bands", []).duplicate(true)
	bands.sort_custom(
		func(left: Dictionary, right: Dictionary) -> bool:
			return float(left.get("minimum_score", 0)) > float(right.get("minimum_score", 0))
	)
	for band in bands:
		if score >= float(band.get("minimum_score", 0)):
			return {
				"grade": str(band.get("grade", "F")),
				"label": str(band.get("label", "Needs support"))
			}
	return {"grade": "F", "label": "Needs support"}


static func _add_assessment(
	record: Dictionary,
	subject_id: String,
	assessment_type: String,
	score: float,
	question_id: String,
	source: String,
	day: int
) -> void:
	if not record.get("subject_ids", []).has(subject_id):
		return
	var assessments: Array = record.get("assessment_records", [])
	(
		assessments
		. append(
			{
				"assessment_id": _new_id("assessment"),
				"academic_year": int(record.get("academic_year", 1)),
				"term": int(record.get("term", 1)),
				"day": day,
				"subject_id": subject_id,
				"assessment_type": assessment_type,
				"score": clampf(score, 0.0, 100.0),
				"maximum_score": 100,
				"question_id": question_id,
				"source": source,
			}
		)
	)
	if assessments.size() > MAX_ASSESSMENTS:
		assessments.pop_front()
	record.assessment_records = assessments


static func _add_event(
	record: Dictionary, event_type: String, day: int, details: Dictionary = {}
) -> void:
	var events: Array = record.get("education_events", [])
	(
		events
		. append(
			{
				"event_id": _new_id("education-event"),
				"type": event_type,
				"day": day,
				"academic_year": int(record.get("academic_year", 1)),
				"term": int(record.get("term", 1)),
				"details": details.duplicate(true),
			}
		)
	)
	if events.size() > MAX_EVENTS:
		events.pop_front()
	record.education_events = events


static func _has_attendance(record: Dictionary, day: int, schedule_id: String) -> bool:
	for attendance in record.get("attendance_records", []):
		if (
			int(attendance.get("day", 0)) == day
			and str(attendance.get("schedule_id", "")) == schedule_id
		):
			return true
	return false


static func _curriculum_for(record: Dictionary, data: Dictionary) -> Dictionary:
	var school := _find_by_id(data.get("institutions", []), str(record.get("school_id", "")))
	return _find_by_id(data.get("curricula", []), str(school.get("curriculum_id", "")))


static func _default_subject_ids(curriculum: Dictionary) -> Array[String]:
	var result: Array[String] = []
	for subject_id in (
		curriculum.get("compulsory_subject_ids", [])
		+ curriculum.get("default_elective_subject_ids", [])
	):
		if not result.has(str(subject_id)):
			result.append(str(subject_id))
	return result


static func _find_by_id(values: Array, wanted: String) -> Dictionary:
	for entry in values:
		if entry is Dictionary and str(entry.get("id", "")) == wanted:
			return entry
	return {}


static func _find_by_kind(values: Array, kind: String) -> Dictionary:
	for entry in values:
		if entry is Dictionary and str(entry.get("kind", "")) == kind:
			return entry
	return {}


static func _subject_id_from_name(value: String) -> String:
	for subject in catalog().get("subjects", []):
		if (
			str(subject.get("name", "")) == value
			or str(subject.get("legacy_score_key", "")) == value
			or str(subject.get("id", "")) == value
		):
			return str(subject.get("id", ""))
	return ""


static func _subject_name(subject_id: String, data: Dictionary) -> String:
	var subject := _find_by_id(data.get("subjects", []), subject_id)
	return str(subject.get("name", subject_id))


static func _question_id_for_subject(subject_id: String) -> String:
	for question in catalog().get("questions", []):
		if str(question.get("subject_id", "")) == subject_id:
			return str(question.get("id", ""))
	return "original-game-question"


static func _has_qualification(record: Dictionary, qualification_id: String) -> bool:
	for qualification in record.get("qualifications", []):
		if str(qualification.get("id", "")) == qualification_id:
			return true
	return false


static func _has_active_registration(record: Dictionary) -> bool:
	for registration in record.get("final_exam_registrations", []):
		if str(registration.get("status", "")) != "results_published":
			return true
	return false


static func _add_skill_experience(
	record: Dictionary, skill_id: String, amount: int, career_links: Array
) -> Dictionary:
	var skills: Array = record.get("skills", [])
	var skill: Dictionary = {}
	for item in skills:
		if str(item.get("skill_id", "")) == skill_id:
			skill = item
			break
	if skill.is_empty():
		skill = {
			"skill_id": skill_id,
			"level": 0,
			"experience": 0,
			"career_links": career_links.duplicate(),
			"certificate_ids": []
		}
		skills.append(skill)
		record.skills = skills
	skill.experience = int(skill.get("experience", 0)) + amount
	skill.level = mini(
		100, maxi(int(skill.get("level", 0)), int(floor(float(skill.experience) / 100.0)))
	)
	return skill


static func _minute_from_label(value: String) -> int:
	var parts := value.split(":")
	if parts.size() != 2 or not parts[0].is_valid_int() or not parts[1].is_valid_int():
		return 0
	return clampi(int(parts[0]) * 60 + int(parts[1]), 0, 1439)


static func _new_id(prefix: String) -> String:
	return (
		"%s-%d-%d"
		% [prefix, int(Time.get_unix_time_from_system() * 1000.0), randi_range(100000, 999999)]
	)


static func _success(code: String, message: String) -> Dictionary:
	return {"ok": true, "code": code, "message": message}


static func _failure(code: String, message: String) -> Dictionary:
	return {"ok": false, "code": code, "message": message}
