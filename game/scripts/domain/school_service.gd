class_name SchoolService
extends RefCounted

const EducationServiceScript = preload("res://scripts/domain/education_service.gd")


static func timetable(character: Variant = null, day: int = 1) -> Array[Dictionary]:
	var record: Dictionary = {}
	if character is Dictionary:
		record = character
	elif character != null:
		record = EducationServiceScript.ensure_character_record(character, day)
	else:
		record = EducationServiceScript.create_student_record("timetable-preview", 16, day)
	var result: Array[Dictionary] = []
	for entry in EducationServiceScript.schedule_for_day(record, day):
		var start_minute := int(entry.get("start_minute", 0))
		var subject_name := str(entry.get("subject_name", entry.get("label", "Activity")))
		(
			result
			. append(
				{
					"id": str(entry.get("id", "")),
					"minute": start_minute,
					"time": "%02d:%02d" % [int(start_minute / 60), start_minute % 60],
					"subject": subject_name,
					"subject_id": entry.get("subject_id", null),
					"kind": str(entry.get("kind", "lesson")),
					"assessment_type": str(entry.get("assessment_type", "")),
					"duration_minutes": int(entry.get("duration_minutes", 0)),
				}
			)
		)
	return result


static func question_for(subject: String) -> Dictionary:
	var subject_id := ""
	var questions: Array = EducationServiceScript.catalog().get("questions", [])
	for question in questions:
		var configured_subject := EducationServiceScript.catalog().get("subjects", []).filter(
			func(entry: Dictionary) -> bool:
				return str(entry.get("id", "")) == str(question.get("subject_id", ""))
		)
		if configured_subject.is_empty():
			continue
		var subject_data: Dictionary = configured_subject[0]
		if (
			subject == str(subject_data.get("name", ""))
			or subject == str(subject_data.get("legacy_score_key", ""))
			or subject == str(subject_data.get("id", ""))
		):
			subject_id = str(question.get("subject_id", ""))
			return {
				"question": str(question.get("prompt", "")),
				"options": question.get("choices", []).duplicate(),
				"correct_index": int(question.get("correct_choice_index", -1)),
				"question_id": str(question.get("id", "")),
				"subject_id": subject_id,
			}
	return {}


static func next_lesson(character: Object, day: int, minute_of_day: int) -> Dictionary:
	var record := EducationServiceScript.ensure_character_record(character, day)
	var lesson := EducationServiceScript.next_lesson(record, day, minute_of_day)
	if lesson.is_empty():
		return {}
	var result := lesson.duplicate(true)
	var start_minute := int(result.get("start_minute", 0))
	result["minute"] = start_minute
	result["time"] = "%02d:%02d" % [int(start_minute / 60), start_minute % 60]
	result["subject"] = str(result.get("subject_name", "Class activity"))
	return result


static func record_result(
	character: Object, day: int, subject: String, correct: bool, time_label: String = ""
) -> int:
	return EducationServiceScript.record_result(character, day, subject, correct, time_label)


static func close_term(character: Object, day: int) -> Dictionary:
	return EducationServiceScript.close_current_term(character, day)


static func choose_progression(character: Object, choice: String, day: int) -> Dictionary:
	return EducationServiceScript.choose_progression(character, choice, day)


static func attend_next_class(character: Object, day: int, minute_of_day: int) -> Dictionary:
	var record := EducationServiceScript.ensure_character_record(character, day)
	var lesson := EducationServiceScript.next_lesson(record, day, minute_of_day)
	if lesson.is_empty():
		return {
			"ok": false,
			"code": "school_complete",
			"message": "There is no class scheduled at this time."
		}
	var question := question_for(str(lesson.get("subject_id", "")))
	if question.is_empty():
		return {
			"ok": false,
			"code": "lesson_unavailable",
			"message": "That lesson has no original game question."
		}
	EducationServiceScript.record_attendance(record, lesson, day, minute_of_day)
	return {"ok": true, "lesson": lesson, "question": question}


static func attendance_summary(character: Object) -> Dictionary:
	var record := EducationServiceScript.ensure_character_record(character)
	return EducationServiceScript.attendance_summary(record)


static func history(character: Object) -> Array:
	var record := EducationServiceScript.ensure_character_record(character)
	return record.get("education_events", []).duplicate(true)
