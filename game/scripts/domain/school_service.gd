class_name SchoolService
extends RefCounted

const TIMETABLE: Array[Dictionary] = [
	{"minute": 480, "time": "08:00", "subject": "Mathematics"},
	{"minute": 540, "time": "09:00", "subject": "English"},
	{"minute": 600, "time": "10:00", "subject": "Break"},
	{"minute": 630, "time": "10:30", "subject": "Computer Studies"},
	{"minute": 690, "time": "11:30", "subject": "Biology"},
	{"minute": 750, "time": "12:30", "subject": "Civic Education"},
]
const QUIZZES: Dictionary = {
	"Mathematics":
	{
		"question": "What is 7 × 8?",
		"options": ["54", "56", "58"],
		"correct_index": 1,
	},
	"English":
	{
		"question": "Which sentence is grammatically correct?",
		"options": ["She go to school.", "She goes to school.", "She going school."],
		"correct_index": 1,
	},
	"Computer Studies":
	{
		"question": "Which part is often called the computer's brain?",
		"options": ["CPU", "Keyboard", "Monitor"],
		"correct_index": 0,
	},
	"Biology":
	{
		"question": "What do green plants use to make food?",
		"options": ["Sunlight", "Plastic", "Sand only"],
		"correct_index": 0,
	},
	"Civic Education":
	{
		"question": "What is one responsibility of a citizen?",
		"options": ["Respecting the law", "Ignoring neighbours", "Damaging public property"],
		"correct_index": 0,
	},
}


static func timetable() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for lesson in TIMETABLE:
		result.append(lesson.duplicate(true))
	return result


static func question_for(subject: String) -> Dictionary:
	var question: Variant = QUIZZES.get(subject, {})
	return question.duplicate(true) if question is Dictionary else {}


static func next_lesson(character: CharacterState, day: int, minute_of_day: int) -> Dictionary:
	for lesson in TIMETABLE:
		var subject := str(lesson["subject"])
		if subject == "Break" or _has_attended(character, day, subject):
			continue
		var start_minute := int(lesson["minute"])
		if minute_of_day <= start_minute + 45:
			return lesson.duplicate(true)
	return {}


static func record_result(
	character: CharacterState, day: int, subject: String, correct: bool, time_label: String = ""
) -> int:
	var previous_score := int(character.academic_scores.get(subject, 60))
	var activity_score := 95 if correct else 45
	var new_score := clampi(
		int(round(float(previous_score) * 0.7 + float(activity_score) * 0.3)), 0, 100
	)
	character.academic_scores[subject] = new_score
	(
		character
		. attendance
		. append(
			{
				"day": day,
				"subject": subject,
				"score": new_score,
				"attended_at": "Day %d · %s" % [day, time_label],
			}
		)
	)
	character.touch()
	return new_score


static func _has_attended(character: CharacterState, day: int, subject: String) -> bool:
	for record in character.attendance:
		if int(record.get("day", 0)) == day and str(record.get("subject", "")) == subject:
			return true
	return false
