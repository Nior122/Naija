class_name PrototypeUI
extends CanvasLayer

signal create_requested(profile: Dictionary)
signal online_requested(profile: Dictionary)
signal chat_requested(message: String)
signal continue_requested
signal interact_requested
signal panel_requested(panel_id: String)
signal save_requested
signal load_requested
signal answer_requested(answer_index: int, quiz_id: String)
signal purchase_requested(item_id: String)
signal consume_requested(item_id: String)
signal attend_requested
signal education_action_requested(action: String, payload: Dictionary)
signal modal_changed(is_open: bool)

const SCHOOL_SERVICE = preload("res://scripts/domain/school_service.gd")
const EducationServiceScript = preload("res://scripts/domain/education_service.gd")
const LifeSimulationServiceScript = preload("res://scripts/domain/life_simulation_service.gd")
const SKIN_TONES: Array[Dictionary] = [
	{"label": "Warm brown", "hex": "#9b654d"},
	{"label": "Deep brown", "hex": "#70452f"},
	{"label": "Golden brown", "hex": "#b77d58"},
	{"label": "Light brown", "hex": "#d0a17d"},
]
const HAIR_STYLES: Array[String] = ["Short curls", "Braids", "Low cut"]
const SHIRT_COLORS: Array[Dictionary] = [
	{"label": "Green school shirt", "hex": "#27734a"},
	{"label": "White school shirt", "hex": "#e5e8d7"},
	{"label": "Blue casual shirt", "hex": "#3f7092"},
]

var _root: Control
var _modal_layer: Control
var _modal_open: bool = false
var _hud: Dictionary = {}
var _name_input: LineEdit
var _age_option: OptionButton
var _type_option: OptionButton
var _skin_option: OptionButton
var _hair_option: OptionButton
var _shirt_option: OptionButton
var _online_status_label: Label
var _chat_history: Array[String] = []
var _chat_input: LineEdit
var _showing_chat: bool = false
var _quiz_id: String = ""
var _quiz_mode: String = "school"


func _ready() -> void:
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(_root)


func show_character_creation(has_save: bool, has_online_session: bool = false) -> void:
	_clear_screen()
	_add_background(Color("#15251e"))
	var card := _create_center_card(Vector2(720.0, 650.0))
	_add_label(card, "NAIJA: ONE WORLD", 15, Color("#70c28a"), HORIZONTAL_ALIGNMENT_CENTER)
	_add_label(
		card,
		"You are beginning your life in Nigeria.",
		28,
		Color("#fff4d4"),
		HORIZONTAL_ALIGNMENT_CENTER
	)
	var creation_blurb := (
		"Create a secondary-school student and start at home in "
		+ "Idera Quarter, a fictional Nigerian neighbourhood."
	)
	_add_label(card, creation_blurb, 15, Color("#d1dccf"), HORIZONTAL_ALIGNMENT_CENTER)
	_name_input = LineEdit.new()
	_name_input.text = "Ayo"
	_name_input.placeholder_text = "Character name"
	_name_input.max_length = 32
	_add_form_row(card, "Name", _name_input)
	_age_option = _option(["15 years old", "16 years old"], 0)
	_add_form_row(card, "Starting age", _age_option)
	_type_option = _option(["Girl", "Boy", "Androgynous"], 2)
	_add_form_row(card, "Character type", _type_option)
	_skin_option = _option(_labels(SKIN_TONES), 0)
	_add_form_row(card, "Skin tone", _skin_option)
	_hair_option = _option(HAIR_STYLES, 0)
	_add_form_row(card, "Hairstyle", _hair_option)
	_shirt_option = _option(_labels(SHIRT_COLORS), 0)
	_add_form_row(card, "Clothing", _shirt_option)
	_add_label(
		card,
		(
			"All art is drawn for this prototype. Offline play needs no account; "
			+ "online play uses a prototype server."
		),
		13,
		Color("#aab9ab"),
		HORIZONTAL_ALIGNMENT_CENTER
	)
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_theme_constant_override("separation", 14)
	card.add_child(actions)
	var start_button := _button("Begin your life", Vector2(200.0, 48.0))
	start_button.pressed.connect(_on_create_pressed)
	actions.add_child(start_button)
	if has_save:
		var continue_button := _button("Continue saved life", Vector2(210.0, 48.0))
		continue_button.pressed.connect(_on_continue_pressed)
		actions.add_child(continue_button)
	var online_actions := HBoxContainer.new()
	online_actions.alignment = BoxContainer.ALIGNMENT_CENTER
	online_actions.add_theme_constant_override("separation", 10)
	card.add_child(online_actions)
	var online_button_label := (
		"Continue online life" if has_online_session else "Create online life"
	)
	var online_button := _button(online_button_label, Vector2(260.0, 44.0))
	online_button.pressed.connect(_on_online_pressed)
	online_actions.add_child(online_button)
	_online_status_label = _add_label(
		card,
		"Online play is optional. Connect to your local Stage 2 server.",
		12,
		Color("#aab9ab"),
		HORIZONTAL_ALIGNMENT_CENTER
	)
	_hud.clear()


func show_game(character: CharacterState, clock: WorldClock, location_name: String) -> void:
	_clear_screen()
	_add_background(Color(0.0, 0.0, 0.0, 0.0))
	var panel := PanelContainer.new()
	panel.position = Vector2(16.0, 16.0)
	panel.custom_minimum_size = Vector2(308.0, 700.0)
	panel.size = panel.custom_minimum_size
	panel.add_theme_stylebox_override("panel", _panel_style(Color(0.93, 0.92, 0.84, 0.96)))
	_root.add_child(panel)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 10)
	panel.add_child(content)
	_add_label(content, "IDERA QUARTER", 13, Color("#377448"), HORIZONTAL_ALIGNMENT_LEFT)
	_hud["name"] = _add_label(content, "", 20, Color("#17231a"), HORIZONTAL_ALIGNMENT_LEFT)
	_hud["money"] = _add_label(content, "", 17, Color("#3a7046"), HORIZONTAL_ALIGNMENT_LEFT)
	_hud["time"] = _add_label(content, "", 15, Color("#425346"), HORIZONTAL_ALIGNMENT_LEFT)
	_hud["location"] = _add_label(content, "", 13, Color("#596558"), HORIZONTAL_ALIGNMENT_LEFT)
	_hud["location"].autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_hud["connection"] = _add_label(
		content, "Offline · local prototype", 12, Color("#69766b"), HORIZONTAL_ALIGNMENT_LEFT
	)
	_add_need_bar(content, "Health", "health")
	_add_need_bar(content, "Energy", "energy")
	_add_need_bar(content, "Hunger", "hunger")
	var divider := HSeparator.new()
	content.add_child(divider)
	_hud["prompt"] = _add_label(
		content,
		"Walk near a person or object to interact.",
		13,
		Color("#304334"),
		HORIZONTAL_ALIGNMENT_LEFT
	)
	_hud["prompt"].autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var interact_button := _button("Interact  ·  E", Vector2(250.0, 42.0))
	interact_button.pressed.connect(func(): interact_requested.emit())
	content.add_child(interact_button)
	var menu_grid := GridContainer.new()
	menu_grid.columns = 2
	menu_grid.add_theme_constant_override("h_separation", 8)
	menu_grid.add_theme_constant_override("v_separation", 8)
	content.add_child(menu_grid)
	_add_menu_button(menu_grid, "Character", "profile")
	_add_menu_button(menu_grid, "Inventory", "inventory")
	_add_menu_button(menu_grid, "Education", "school")
	_add_menu_button(menu_grid, "Nearby chat", "chat")
	_add_menu_button(menu_grid, "Save / Load", "save")
	_add_menu_button(menu_grid, "Settings", "settings")
	_add_menu_button(menu_grid, "Map data", "geography")
	_hud["message"] = _add_label(content, "", 12, Color("#386546"), HORIZONTAL_ALIGNMENT_LEFT)
	_hud["message"].autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_add_label(
		content,
		"Move: WASD / arrows   Run: Shift\nInteract: E   Save often before you quit",
		11,
		Color("#6c786d"),
		HORIZONTAL_ALIGNMENT_LEFT
	)
	refresh_hud(character, clock, location_name, "")


func refresh_hud(
	character: CharacterState, clock: WorldClock, location_name: String, prompt: String
) -> void:
	if _hud.is_empty():
		return
	var life_profile := character.get_life_profile()
	var stage_label := str(life_profile.get("life_stage_label", character.life_stage_id))
	var status_label := str(
		life_profile.get("life_status_label", character.life_status.capitalize())
	)
	_hud["name"].text = "%s  ·  Age %d  ·  %s" % [character.name, character.age, status_label]
	_hud["money"].text = "Balance: ₦%s  ·  %s" % [_format_number(character.money), stage_label]
	var world_date := clock.calendar_date()
	_hud["time"].text = (
		"%s  ·  %s\n%s  ·  Week %d  ·  %s"
		% [
			LifeSimulationServiceScript.date_label(world_date),
			clock.weekday_name(),
			clock.time_label_with_seconds(),
			clock.week_number(),
			clock.daypart(),
		]
	)
	_hud["location"].text = location_name
	_hud["health"].value = character.health
	_hud["energy"].value = character.energy
	_hud["hunger"].value = character.hunger
	_hud["prompt"].text = (
		prompt if not prompt.is_empty() else "Walk near a person or object to interact."
	)


func show_profile(character: CharacterState) -> void:
	var life_profile := character.get_life_profile()
	var dob: Dictionary = life_profile.get("date_of_birth", character.date_of_birth)
	var dob_label := "Not recorded"
	if LifeSimulationServiceScript.valid_date(dob):
		dob_label = (
			"%s  ·  %04d-%02d-%02d"
			% [
				LifeSimulationServiceScript.date_label(dob),
				int(dob.get("year", 0)),
				int(dob.get("month", 0)),
				int(dob.get("day", 0)),
			]
		)
	var card := _open_modal(
		"Character & life record", "A persistent person in the shared Nigeria world"
	)
	_add_modal_text(card, "Name: %s" % character.name)
	_add_modal_text(card, "Age: %d  ·  Date of birth: %s" % [character.age, dob_label])
	_add_modal_text(
		card,
		(
			"Life stage: %s  ·  Status: %s"
			% [
				str(life_profile.get("life_stage_label", character.life_stage_id)),
				str(life_profile.get("life_status_label", character.life_status.capitalize())),
			]
		)
	)
	if character.life_status == "deceased":
		_add_modal_text(
			card,
			(
				"Life ended at age %d  ·  Cause category: %s"
				% [
					character.age_at_death,
					character.death_cause.replace("_", " ").capitalize(),
				]
			)
		)
	_add_modal_text(card, "Character type: %s" % character.character_type.capitalize())
	_add_modal_text(card, "Education: %s" % character.education_level)
	_add_modal_text(
		card,
		(
			"Home: %s  ·  Household: %s"
			% [
				character.home_id,
				str(character.household.get("home_type", "Family home")),
			]
		)
	)
	_add_modal_text(card, "Family")
	var family_members: Array = life_profile.get("family", [])
	var displayed_family := 0
	for member in family_members:
		if not member is Dictionary:
			continue
		var member_id := str(member.get("person_id", member.get("character_id", "")))
		var role := str(member.get("family_role", "family member")).replace("_", " ").capitalize()
		var member_status := str(member.get("life_status", "alive")).capitalize()
		var member_line := (
			"%s  ·  %s  ·  age %d  ·  %s"
			% [
				str(member.get("name", "Family member")),
				role,
				int(member.get("age", 0)),
				member_status,
			]
		)
		if member_id == character.character_id:
			member_line = (
				"%s  ·  You  ·  age %d  ·  %s" % [character.name, character.age, member_status]
			)
		_add_modal_text(card, member_line)
		displayed_family += 1
	if displayed_family == 0:
		_add_modal_text(card, "No family members have been recorded.")
	_add_modal_text(card, "Relationships")
	var relationships: Array = life_profile.get("relationships", [])
	var displayed_relationships := 0
	for relationship in relationships:
		if not relationship is Dictionary:
			continue
		var relationship_type := (
			str(relationship.get("type", "relationship")).replace("_", " ").capitalize()
		)
		var status := str(relationship.get("status", "active")).replace("_", " ")
		var participant_names: Variant = relationship.get("participant_names", [])
		var participants: Variant = relationship.get("participants", [])
		if (
			(not participant_names is Array or participant_names.is_empty())
			and participants is Array
		):
			var resolved_names: Array[String] = []
			for participant_id in participants:
				if str(participant_id) == character.character_id:
					resolved_names.append(character.name)
					continue
				for member in family_members:
					if (
						member is Dictionary
						and (
							str(member.get("person_id", member.get("character_id", "")))
							== str(participant_id)
						)
					):
					resolved_names.append(str(member.get("name", "Family member")))
					break
			participant_names = resolved_names
		var relationship_line := "%s  ·  %s" % [relationship_type, status.capitalize()]
		var relationship_stage := str(relationship.get("stage", "")).replace("_", " ")
		if not relationship_stage.is_empty():
			relationship_line += "  ·  " + relationship_stage.capitalize()
		if participant_names is Array and not participant_names.is_empty():
			var names_line := ""
			for participant_name in participant_names:
				if not names_line.is_empty():
					names_line += ", "
				names_line += str(participant_name)
			relationship_line += "  ·  " + names_line
		_add_modal_text(card, relationship_line)
		displayed_relationships += 1
	if displayed_relationships == 0:
		_add_modal_text(card, "No personal relationships have been recorded yet.")
	_add_modal_text(card, "Education record")
	var education_record: Dictionary = character.education_record
	_add_modal_text(
		card,
		(
			"%s  ·  Term %d  ·  %s"
			% [
				str(education_record.get("current_class_id", "Not enrolled")),
				int(education_record.get("term", 0)),
				(
					str(education_record.get("enrollment_status", "Not recorded"))
					. replace("_", " ")
					. capitalize()
				),
			]
		)
	)
	var attendance_records: Variant = education_record.get("attendance_records", [])
	var assessment_records: Variant = education_record.get("assessment_records", [])
	var qualifications: Variant = education_record.get("qualifications", [])
	_add_modal_text(
		card,
		(
			"Attendance records: %d  ·  Assessments: %d  ·  Qualifications: %d"
			% [
				attendance_records.size() if attendance_records is Array else 0,
				assessment_records.size() if assessment_records is Array else 0,
				qualifications.size() if qualifications is Array else 0,
			]
		)
	)
	var education_events: Variant = education_record.get("education_events", [])
	if education_events is Array and not education_events.is_empty():
		_add_modal_text(card, "Recent education history")
		for index in range(education_events.size() - 1, maxi(-1, education_events.size() - 4), -1):
			var education_event: Variant = education_events[index]
			if not education_event is Dictionary:
				continue
			var details: Variant = education_event.get("details", {})
			var detail_label := ""
			if details is Dictionary and not details.is_empty():
				detail_label = "  ·  " + str(details.get("class_id", details.get("program_id", "")))
			_add_modal_text(
				card,
				(
					"Day %d  ·  %s%s"
					% [
						int(education_event.get("day", 0)),
						(
							str(education_event.get("type", "Education event"))
							. replace("_", " ")
							. capitalize()
						),
						detail_label,
					]
				)
			)
	_add_modal_text(card, "Recorded life history")
	var history: Array = life_profile.get("life_history", character.life_history)
	if history.is_empty():
		_add_modal_text(card, "No life events have been recorded.")
	else:
		for index in range(history.size() - 1, maxi(-1, history.size() - 11), -1):
			var event: Variant = history[index]
			if not event is Dictionary:
				continue
			var event_date: Dictionary = event.get("date", {})
			var event_label := (
				LifeSimulationServiceScript.date_label(event_date)
				if LifeSimulationServiceScript.valid_date(event_date)
				else "Date unknown"
			)
			_add_modal_text(
				card,
				(
					"%s  ·  %s"
					% [event_label, str(event.get("summary", event.get("type", "Life event")))]
				)
			)
	_add_modal_text(
		card, "Reputation: %d · Student at Idera Community Secondary School" % character.reputation
	)
	_add_modal_close(card)


func show_inventory(character: CharacterState, message: String = "") -> void:
	var card := _open_modal("School bag and belongings", message)
	if character.inventory.is_empty():
		_add_modal_text(card, "Your bag is empty.")
	for item in character.inventory:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		card.add_child(row)
		var description := _make_label(
			"%s  ×%d" % [str(item.get("name", "Item")), int(item.get("quantity", 0))],
			15,
			Color("#233229"),
			HORIZONTAL_ALIGNMENT_LEFT
		)
		description.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(description)
		if int(item.get("hunger_restore", 0)) > 0:
			var eat_button := _button("Eat", Vector2(82.0, 34.0))
			eat_button.pressed.connect(_on_consume_pressed.bind(str(item.get("id", ""))))
			row.add_child(eat_button)
	_add_modal_close(card)


func show_education(
	character: CharacterState, clock: WorldClock, current_location: String, is_online: bool = false
) -> void:
	var record: Dictionary = character.education_record
	var data: Dictionary = EducationServiceScript.catalog()
	var school: Dictionary = _catalog_item(
		data.get("institutions", []), str(record.get("school_id", ""))
	)
	var class_data: Dictionary = _catalog_item(
		data.get("school_years", []), str(record.get("current_class_id", ""))
	)
	var attendance: Dictionary = EducationServiceScript.attendance_summary(
		record, int(record.get("academic_year", 1)), int(record.get("term", 1))
	)
	var card := _open_modal(
		"Education & pathways",
		"Fictional, configurable learning progression in the shared Nigeria world"
	)
	if is_online:
		_add_modal_text(
			card,
			"Online education records and clock changes are validated and saved by the shared server."
		)
	_add_modal_text(
		card,
		(
			"%s · %s · Academic year %d, term %d/%d"
			% [
				str(school.get("name", "School")),
				str(class_data.get("label", record.get("current_class_id", "SS1"))),
				int(record.get("academic_year", 1)),
				int(record.get("term", 1)),
				int(data.get("calendar", {}).get("terms_per_academic_year", 3))
			]
		)
	)
	_add_modal_text(
		card,
		(
			"Status: %s · Current-term attendance: %d%% (%d/%d)"
			% [
				str(record.get("progression_status", "active")).replace("_", " ").capitalize(),
				int(attendance.get("percent", 0)),
				int(attendance.get("attended", 0)),
				int(attendance.get("scheduled", 0))
			]
		)
	)
	_add_modal_text(card, "Subjects: %s" % ", ".join(EducationServiceScript.subject_names(record)))
	var curriculum := _catalog_item(data.get("curricula", []), str(school.get("curriculum_id", "")))
	_add_modal_text(
		card, "Optional subject choices · changing subjects does not erase past results"
	)
	for group in curriculum.get("elective_groups", []):
		for subject_id in group.get("subject_ids", []):
			var elective := _catalog_item(data.get("subjects", []), str(subject_id))
			if not record.get("subject_ids", []).has(str(subject_id)):
				_add_education_action_button(
					card,
					"Choose elective · %s" % str(elective.get("name", subject_id)),
					"choose_elective",
					{"subject_id": str(subject_id)}
				)
	_add_modal_text(card, "Current academic averages:")
	for subject_name in character.academic_scores.keys():
		_add_modal_text(
			card, "%s: %d / 100" % [str(subject_name), int(character.academic_scores[subject_name])]
		)
	var schedule := SCHOOL_SERVICE.timetable(character, clock.day)
	_add_modal_text(
		card, "Today's configurable timetable · Day %d · %s" % [clock.day, clock.time_label()]
	)
	for entry in schedule:
		var label := str(entry.get("subject", "Activity"))
		var status := (
			"break"
			if str(entry.get("kind", "")) == "break"
			else str(entry.get("assessment_type", "learning"))
		)
		_add_modal_text(
			card,
			"%s · %s · %s" % [str(entry.get("time", "--:--")), label, status.replace("_", " ")]
		)
	if current_location == "classroom":
		var attend_button := _button("Attend next class / exam paper", Vector2(300.0, 40.0))
		attend_button.pressed.connect(func(): attend_requested.emit())
		card.add_child(attend_button)
	elif current_location == "campus":
		_add_education_action_button(card, "begin_course", "Attend next tertiary course", {})
		var enrollment: Variant = record.get("tertiary_enrollment", null)
		if (
			enrollment is Dictionary
			and (
				clock.day
				>= (
					int(enrollment.get("semester_start_day", clock.day))
					+ int(data.get("tertiary_calendar", {}).get("term_length_game_days", 5))
				)
			)
		):
			_add_education_action_button(
				card, "close_tertiary_semester", "Publish semester result", {}
			)
	elif current_location == "training_center":
		_add_education_action_button(
			card, "practice_training", "Complete a practical training session", {}
		)
	elif current_location == "schoolyard":
		var activity := EducationServiceScript.current_activity(
			record, clock.day, clock.minute_of_day, current_location
		)
		if not activity.is_empty():
			var activity_data := _catalog_item(
				data.get("activities", []), str(activity.get("activity_id", ""))
			)
			_add_education_action_button(
				card,
				"attend_activity",
				"Join %s" % str(activity_data.get("name", "school activity")),
				{"activity_id": str(activity.get("activity_id", ""))}
			)
	if current_location == "home":
		_add_education_action_button(card, "family_support", "Ask family about study support", {})
	_add_education_action_button(
		card, "pay_school_fees", "Pay this term's school fees / materials", {}
	)
	var record_status := str(record.get("progression_status", ""))
	var term_due := (
		clock.day
		>= (
			int(record.get("term_start_day", clock.day))
			+ int(data.get("calendar", {}).get("term_length_game_days", 5))
		)
	)
	if record_status == "active" and term_due:
		_add_education_action_button(card, "close_term", "Publish term results", {})
	if record_status == "eligible_to_promote":
		_add_education_action_button(
			card, "choose_progression", "Promote to next class", {"choice": "promote"}
		)
	if record_status in ["eligible_to_promote", "remediation_available"]:
		_add_education_action_button(
			card, "choose_progression", "Take a supported recovery year", {"choice": "remediate"}
		)
		_add_education_action_button(
			card, "choose_progression", "Repeat this class", {"choice": "repeat"}
		)
		_add_education_action_button(
			card, "choose_progression", "Leave school (history preserved)", {"choice": "leave"}
		)
	if record_status == "final_exam_eligible":
		_add_education_action_button(
			card,
			"register_final_exam",
			"Register for fictional senior certificate exam",
			{"subject_ids": record.get("subject_ids", []).duplicate()}
		)
		if current_location == "classroom":
			_add_education_action_button(
				card, "begin_final_exam", "Begin next registered exam paper", {}
			)
	var previous_tertiary: Variant = record.get("tertiary_enrollment", null)
	var previous_program_complete := (
		not previous_tertiary is Dictionary
		or str(previous_tertiary.get("status", "")) == "completed"
	)
	var can_apply_tertiary := (
		record_status == "secondary_complete"
		or (record_status == "tertiary_complete" and previous_program_complete)
	)
	if can_apply_tertiary:
		_add_modal_text(
			card,
			"Tertiary programs · prototype entry checks use age, final-exam credits and current results."
		)
		for program in data.get("programs", []):
			var institution := _catalog_item(
				data.get("institutions", []), str(program.get("institution_id", ""))
			)
			_add_modal_text(
				card,
				(
					"%s · %s · ₦%s/term · %s"
					% [
						str(institution.get("name", "Institution")),
						str(program.get("name", "Program")),
						_format_number(int(program.get("tuition_per_term_ngn", 0))),
						str(program.get("award", "Award"))
					]
				)
			)
			var institution_location: Dictionary = institution.get("geographic_location", {})
			_add_modal_text(
				card,
				(
					"Map anchor: %s · %s State · %s LGA · fictional coordinate, not an address"
					% [
						str(institution_location.get("settlement_name", "Akure")),
						str(institution_location.get("state_name", "Ondo")),
						str(institution_location.get("lga_name", "Akure South"))
					]
				)
			)
			_add_education_action_button(
				card,
				"apply_program",
				"Apply · %s" % str(program.get("name", "Program")),
				{"program_id": str(program.get("id", ""))}
			)
	for application in record.get("admission_applications", []):
		if str(application.get("status", "")) == "offered":
			var program_name := str(
				_catalog_item(data.get("programs", []), str(application.get("program_id", ""))).get(
					"name", "program"
				)
			)
			_add_modal_text(
				card,
				(
					"Admission offer: %s · %s"
					% [program_name, str(application.get("decision_reason", ""))]
				)
			)
			_add_education_action_button(
				card,
				"respond_application",
				"Accept · %s" % program_name,
				{"application_id": str(application.get("application_id", "")), "accept": true}
			)
			_add_education_action_button(
				card,
				"respond_application",
				"Decline · %s" % program_name,
				{"application_id": str(application.get("application_id", "")), "accept": false}
			)
	var tertiary: Variant = record.get("tertiary_enrollment", null)
	if tertiary is Dictionary:
		var tertiary_program := _catalog_item(
			data.get("programs", []), str(tertiary.get("program_id", ""))
		)
		_add_modal_text(
			card,
			(
				"Program: %s · %s · Semester %d/%d · %s"
				% [
					str(tertiary_program.get("name", "Tertiary study")),
					str(tertiary.get("award", "Award")),
					int(tertiary.get("semester", 1)),
					int(tertiary.get("duration_semesters", 1)),
					str(tertiary.get("status", "active")).capitalize()
				]
			)
		)
		if current_location != "campus":
			_add_modal_text(
				card,
				(
					"Travel through the school yard's tertiary campus gate to attend "
					+ "courses. Your record persists if you leave or transfer."
				)
			)
	_add_modal_text(
		card, "Vocational courses & mentored apprenticeships · fictional community skills centre"
	)
	for training in data.get("training_programs", []):
		_add_modal_text(
			card,
			(
				"%s · %d sessions · ₦%d/session · %s"
				% [
					str(training.get("name", "Skills course")),
					int(training.get("duration_sessions", 1)),
					int(training.get("session_cost_ngn", 0)),
					str(training.get("certificate_name", "Certificate"))
				]
			)
		)
		_add_education_action_button(
			card,
			"enroll_training",
			"Enroll · %s" % str(training.get("name", "Course")),
			{"training_program_id": str(training.get("id", ""))}
		)
		_add_education_action_button(
			card,
			"enroll_apprenticeship",
			"Apprentice · %s" % str(training.get("name", "Trade")),
			{"training_program_id": str(training.get("id", ""))}
		)
	_add_modal_text(
		card, "Study awards · prototype criteria, limited awards, not official scholarships"
	)
	for scholarship in data.get("scholarships", []):
		_add_education_action_button(
			card,
			"apply_scholarship",
			(
				"Apply · %s (₦%s)"
				% [
					str(scholarship.get("name", "Study award")),
					_format_number(int(scholarship.get("award_amount_ngn", 0)))
				]
			),
			{"scholarship_id": str(scholarship.get("id", ""))}
		)
	var funding := 0
	for award in record.get("scholarships", []):
		if str(award.get("status", "")) == "awarded":
			funding += int(award.get("funding_balance_ngn", 0))
	_add_modal_text(card, "Available education scholarship funding: ₦%s" % _format_number(funding))
	_add_modal_text(
		card,
		(
			"Qualifications: %s"
			% (
				" · ".join(_qualification_names(record))
				if not _qualification_names(record).is_empty()
				else "No certificate yet"
			)
		)
	)
	_add_modal_text(card, "Recent education history:")
	var events: Array = record.get("education_events", [])
	for index in range(maxi(0, events.size() - 5), events.size()):
		var event: Dictionary = events[index]
		_add_modal_text(
			card,
			(
				"Day %d · %s"
				% [
					int(event.get("day", 1)),
					str(event.get("type", "education event")).replace("_", " ").capitalize()
				]
			)
		)
	var location: Dictionary = school.get("geographic_location", {})
	_add_modal_text(
		card,
		(
			"School geography: %s · %s State · %s LGA · fictional map anchor, not an address."
			% [
				str(location.get("settlement_name", "Akure")),
				str(location.get("state_name", "Ondo")),
				str(location.get("lga_name", "Akure South"))
			]
		)
	)
	_add_modal_text(
		card,
		(
			"All institutions, policies and exam questions in this catalog are "
			+ "fictional game content. No WAEC/NECO papers are reproduced; "
			+ "no real institution is endorsed."
		)
	)
	_add_modal_close(card)


func show_timetable(character: CharacterState, clock: WorldClock, current_location: String) -> void:
	var card := _open_modal(
		"School timetable", "Configurable schedule · fictional school prototype"
	)
	_add_modal_text(card, "Current time: Day %d · %s" % [clock.day, clock.time_label()])
	var schedule := SCHOOL_SERVICE.timetable(character, clock.day)
	for lesson in schedule:
		var subject := str(lesson.get("subject", "Activity"))
		var type_label := str(lesson.get("kind", "lesson")).capitalize()
		_add_modal_text(
			card, "%s — %s · %s" % [str(lesson.get("time", "--:--")), subject, type_label]
		)
	if current_location == "classroom":
		var attend_button := _button("Attend next class activity", Vector2(280.0, 42.0))
		attend_button.pressed.connect(func(): attend_requested.emit())
		card.add_child(attend_button)
	else:
		_add_modal_text(
			card, "Walk or take the bus to the school, enter the yard, then enter your classroom."
		)
	_add_modal_close(card)


func _catalog_item(entries: Array, item_id: String) -> Dictionary:
	for entry in entries:
		if entry is Dictionary and str(entry.get("id", "")) == item_id:
			return entry
	return {}


func _qualification_names(record: Dictionary) -> Array[String]:
	var names: Array[String] = []
	for qualification in record.get("qualifications", []):
		names.append(
			(
				"%s (%s)"
				% [
					str(qualification.get("name", "Certificate")),
					str(qualification.get("award", "Award"))
				]
			)
		)
	return names


func _add_education_action_button(
	parent: VBoxContainer, label: String, action: String, payload: Dictionary
) -> void:
	var button := _button(label, Vector2(470.0, 36.0))
	button.pressed.connect(_on_education_action.bind(action, payload))
	parent.add_child(button)


func _on_education_action(action: String, payload: Dictionary) -> void:
	education_action_requested.emit(action, payload.duplicate(true))


func show_education_result(result: Dictionary) -> void:
	var success := bool(result.get("ok", true))
	var title := "Education updated" if success else "Education action not completed"
	var message := str(result.get("message", "Your education record has been refreshed."))
	show_notice(title, message)


func show_save_menu(has_save: bool) -> void:
	var card := _open_modal(
		"Local save", "Progress is stored on this device in Godot's user data folder."
	)
	var save_button := _button("Save progress now", Vector2(250.0, 42.0))
	save_button.pressed.connect(func(): save_requested.emit())
	card.add_child(save_button)
	if has_save:
		var load_button := _button("Load saved progress", Vector2(250.0, 42.0))
		load_button.pressed.connect(func(): load_requested.emit())
		card.add_child(load_button)
	_add_modal_text(
		card,
		"The clock pauses when the game is closed. This is a local prototype save, not an online account."
	)
	_add_modal_close(card)


func show_save_result(message: String, success: bool) -> void:
	var card := _open_modal("Progress saved" if success else "Save not completed", message)
	_add_modal_close(card)


func show_shop(balance: int, message: String = "") -> void:
	var card := _open_modal(
		"Neighbourhood shop",
		(
			message
			if not message.is_empty()
			else "A small selection for your school day · Balance ₦%s" % _format_number(balance)
		)
	)
	_add_shop_row(card, "meat_pie", "Meat pie", 350, "+24 hunger")
	_add_shop_row(card, "bottled_water", "Bottled water", 100, "+8 hunger")
	_add_modal_close(card)


func show_chat() -> void:
	var card := _open_modal(
		"Nearby player chat", "Messages are relayed by the server to nearby players."
	)
	_showing_chat = true
	if _chat_history.is_empty():
		_add_modal_text(card, "No recent messages. Walk near another player to chat with them.")
	else:
		for line in _chat_history:
			_add_modal_text(card, line)
	var input_row := HBoxContainer.new()
	input_row.add_theme_constant_override("separation", 8)
	card.add_child(input_row)
	_chat_input = LineEdit.new()
	_chat_input.placeholder_text = "Write a short message…"
	_chat_input.max_length = 200
	_chat_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_chat_input.text_submitted.connect(_submit_chat_message)
	input_row.add_child(_chat_input)
	var send_button := _button("Send", Vector2(90.0, 36.0))
	send_button.pressed.connect(_submit_chat_message.bind(""))
	input_row.add_child(send_button)
	_add_modal_close(card)


func add_chat_message(sender: String, message: String) -> void:
	_chat_history.append("%s: %s" % [sender, message])
	if _chat_history.size() > 30:
		_chat_history.pop_front()


func _submit_chat_message(submitted_text: String = "") -> void:
	if not is_instance_valid(_chat_input):
		return
	var message_text := submitted_text if not submitted_text.is_empty() else _chat_input.text
	message_text = message_text.strip_edges()
	if message_text.is_empty():
		return
	chat_requested.emit(message_text)
	_chat_input.clear()


func show_dialogue(speaker: String, lines: Array[String]) -> void:
	var card := _open_modal(speaker, "Conversation")
	for line in lines:
		_add_modal_text(card, "“%s”" % line)
	_add_modal_close(card, "Close")


func show_quiz(
	subject: String, question: Dictionary, quiz_id: String = "", mode: String = "school"
) -> void:
	_quiz_id = quiz_id
	_quiz_mode = mode
	var title := "Class activity"
	var guidance := "Choose one answer. Your result will update your subject record."
	match mode:
		"final_exam":
			title = "Fictional senior certificate exam"
			guidance = "Original prototype content only · not an official WAEC or NECO paper."
		"tertiary":
			title = "Tertiary course assessment"
			guidance = "Complete configured course assessments for your semester record."
	var card := _open_modal("%s · %s" % [title, subject], guidance)
	_add_modal_text(
		card, str(question.get("question", "The teacher has not added a question yet."))
	)
	var options: Array = question.get("options", [])
	for index in range(options.size()):
		var answer_button := _button(str(options[index]), Vector2(400.0, 40.0))
		answer_button.pressed.connect(_on_answer_pressed.bind(index))
		card.add_child(answer_button)
	_add_modal_close(card, "Leave activity")


func show_quiz_result(
	subject: String,
	correct: bool,
	score: int,
	mode: String = "school",
	certificate_eligible: Variant = null
) -> void:
	var title := "Class recorded · %s" % subject
	var result_text := (
		"Correct — nice work." if correct else "Not quite. Learning is part of the day."
	)
	if mode == "final_exam":
		title = "Senior exam paper recorded · %s" % subject
		result_text = "Original prototype exam response recorded. This is not an official result."
		if certificate_eligible is bool:
			result_text = (
				"Prototype certificate eligibility reached. This is not an official WAEC or NECO qualification."
				if certificate_eligible
				else "The configured prototype final-credit threshold is not yet met."
			)
	elif mode == "tertiary":
		title = "Tertiary assessment recorded · %s" % subject
		result_text = (
			"The course result is saved. Complete all configured course assessments "
			+ "before closing the semester."
		)
	var card := _open_modal(title, result_text)
	_add_modal_text(card, "Current subject / course score: %d / 100" % score)
	_add_modal_text(card, "Attendance and your education history are saved with your character.")
	_add_modal_close(card, "Continue")


func show_notice(title: String, message: String) -> void:
	var card := _open_modal(title, message)
	_add_modal_close(card)


func show_shop_result(balance: int, message: String) -> void:
	show_shop(balance, "%s  ·  Balance ₦%s" % [message, _format_number(balance)])


func notify(message: String) -> void:
	if not _hud.is_empty() and is_instance_valid(_hud.get("message")):
		_hud["message"].text = message
	elif is_instance_valid(_online_status_label):
		_online_status_label.text = message


func set_online_status(status: String) -> void:
	if is_instance_valid(_online_status_label):
		_online_status_label.text = status
	if _hud.has("connection") and is_instance_valid(_hud["connection"]):
		_hud["connection"].text = status


func set_interaction_prompt(prompt: String) -> void:
	if _hud.has("prompt") and is_instance_valid(_hud["prompt"]):
		_hud["prompt"].text = prompt


func is_modal_open() -> bool:
	return _modal_open


func _on_create_pressed() -> void:
	var profile := _profile_from_form()
	if not profile.is_empty():
		create_requested.emit(profile)


func _on_online_pressed() -> void:
	var profile := _profile_from_form()
	if not profile.is_empty():
		online_requested.emit(profile)


func _profile_from_form() -> Dictionary:
	var character_name := _name_input.text.strip_edges()
	if character_name.is_empty():
		_name_input.grab_focus()
		return {}
	var skin_index := clampi(_skin_option.get_selected_id(), 0, SKIN_TONES.size() - 1)
	var shirt_index := clampi(_shirt_option.get_selected_id(), 0, SHIRT_COLORS.size() - 1)
	var hair_index := clampi(_hair_option.get_selected_id(), 0, HAIR_STYLES.size() - 1)
	var character_types: Array[String] = ["girl", "boy", "androgynous"]
	var character_type: String = character_types[clampi(_type_option.get_selected_id(), 0, 2)]
	return {
		"name": character_name,
		"age": 16 if _age_option.get_selected_id() == 1 else 15,
		"character_type": character_type,
		"appearance":
		{
			"skin_tone": SKIN_TONES[skin_index]["hex"],
			"skin_tone_name": SKIN_TONES[skin_index]["label"],
			"hairstyle": HAIR_STYLES[hair_index],
			"hair_color": "#2c211d",
			"clothing": SHIRT_COLORS[shirt_index]["label"],
			"clothing_color": SHIRT_COLORS[shirt_index]["hex"],
		}
	}


func _on_continue_pressed() -> void:
	continue_requested.emit()


func _on_answer_pressed(answer_index: int) -> void:
	answer_requested.emit(answer_index, _quiz_id)
	_quiz_id = ""


func _on_consume_pressed(item_id: String) -> void:
	consume_requested.emit(item_id)


func _add_menu_button(parent: GridContainer, label: String, panel_id: String) -> void:
	var button := _button(label, Vector2(124.0, 38.0))
	button.pressed.connect(_on_panel_pressed.bind(panel_id))
	parent.add_child(button)


func _on_panel_pressed(panel_id: String) -> void:
	panel_requested.emit(panel_id)


func _add_need_bar(parent: VBoxContainer, label: String, key: String) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	parent.add_child(row)
	var title := _make_label(label, 13, Color("#344337"), HORIZONTAL_ALIGNMENT_LEFT)
	title.custom_minimum_size = Vector2(62.0, 20.0)
	row.add_child(title)
	var bar := ProgressBar.new()
	bar.min_value = 0.0
	bar.max_value = 100.0
	bar.custom_minimum_size = Vector2(190.0, 18.0)
	bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.show_percentage = false
	row.add_child(bar)
	_hud[key] = bar


func _add_form_row(parent: VBoxContainer, label: String, control: Control) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	var title := _make_label(label, 14, Color("#24352a"), HORIZONTAL_ALIGNMENT_LEFT)
	title.custom_minimum_size = Vector2(150.0, 36.0)
	row.add_child(title)
	control.custom_minimum_size = Vector2(430.0, 38.0)
	control.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(control)
	parent.add_child(row)


func _option(labels: Array, selected_index: int) -> OptionButton:
	var result := OptionButton.new()
	for index in range(labels.size()):
		result.add_item(str(labels[index]), index)
	result.select(selected_index)
	return result


func _labels(entries: Array[Dictionary]) -> Array[String]:
	var result: Array[String] = []
	for entry in entries:
		result.append(str(entry["label"]))
	return result


func _button(label: String, minimum_size: Vector2 = Vector2(160.0, 38.0)) -> Button:
	var result := Button.new()
	result.text = label
	result.custom_minimum_size = minimum_size
	result.focus_mode = Control.FOCUS_ALL
	return result


func _add_background(color: Color) -> void:
	var background := ColorRect.new()
	background.color = color
	background.mouse_filter = (
		Control.MOUSE_FILTER_IGNORE if color.a == 0.0 else Control.MOUSE_FILTER_STOP
	)
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.add_child(background)


func _create_center_card(minimum_size: Vector2) -> VBoxContainer:
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = minimum_size
	panel.add_theme_stylebox_override("panel", _panel_style(Color("#f0f0e4")))
	center.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	panel.add_child(box)
	return box


func _open_modal(title: String, subtitle: String) -> VBoxContainer:
	_close_modal()
	_modal_layer = Control.new()
	_modal_layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.add_child(_modal_layer)
	var shade := ColorRect.new()
	shade.color = Color(0.02, 0.04, 0.03, 0.68)
	shade.mouse_filter = Control.MOUSE_FILTER_STOP
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_modal_layer.add_child(shade)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_modal_layer.add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(590.0, 430.0)
	panel.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	panel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	panel.add_theme_stylebox_override("panel", _panel_style(Color("#f2f0e4")))
	center.add_child(panel)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(540.0, 390.0)
	panel.add_child(scroll)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 10)
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(content)
	_add_label(content, title, 21, Color("#1d3928"), HORIZONTAL_ALIGNMENT_LEFT)
	if not subtitle.is_empty():
		_add_label(content, subtitle, 13, Color("#617264"), HORIZONTAL_ALIGNMENT_LEFT)
	_modal_open = true
	modal_changed.emit(true)
	return content


func _add_modal_text(parent: VBoxContainer, text_value: String) -> Label:
	var label := _make_label(text_value, 14, Color("#27352b"), HORIZONTAL_ALIGNMENT_LEFT)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(label)
	return label


func _add_modal_close(parent: VBoxContainer, label: String = "Close") -> void:
	var button := _button(label, Vector2(170.0, 40.0))
	button.pressed.connect(_close_modal)
	parent.add_child(button)


func _add_shop_row(
	parent: VBoxContainer, item_id: String, label: String, price: int, effect: String
) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	parent.add_child(row)
	var description := _make_label(
		"%s  ·  ₦%d  ·  %s" % [label, price, effect],
		14,
		Color("#26372b"),
		HORIZONTAL_ALIGNMENT_LEFT
	)
	description.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(description)
	var buy_button := _button("Buy", Vector2(82.0, 34.0))
	buy_button.pressed.connect(_on_purchase_pressed.bind(item_id))
	row.add_child(buy_button)


func _on_purchase_pressed(item_id: String) -> void:
	purchase_requested.emit(item_id)


func _close_modal() -> void:
	if not _modal_open:
		return
	if is_instance_valid(_modal_layer):
		_modal_layer.queue_free()
	_modal_layer = null
	_modal_open = false
	_showing_chat = false
	modal_changed.emit(false)


func _clear_screen() -> void:
	if _modal_open:
		_close_modal()
	for child in _root.get_children():
		child.queue_free()
	_hud.clear()
	_online_status_label = null
	_chat_input = null
	_showing_chat = false
	_quiz_id = ""


func _add_label(parent: Node, text_value: String, size: int, color: Color, alignment: int) -> Label:
	var label := _make_label(text_value, size, color, alignment)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(label)
	return label


func _make_label(text_value: String, size: int, color: Color, alignment: int) -> Label:
	var label := Label.new()
	label.text = text_value
	label.horizontal_alignment = alignment
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	return label


func _panel_style(background: Color) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = background
	style.border_color = Color("#83937c")
	style.border_width_left = 1
	style.border_width_top = 1
	style.border_width_right = 1
	style.border_width_bottom = 1
	style.corner_radius_top_left = 12
	style.corner_radius_top_right = 12
	style.corner_radius_bottom_left = 12
	style.corner_radius_bottom_right = 12
	style.content_margin_left = 22.0
	style.content_margin_top = 18.0
	style.content_margin_right = 22.0
	style.content_margin_bottom = 18.0
	return style


func _attended(character: CharacterState, day: int, subject: String) -> bool:
	for record in character.attendance:
		if int(record.get("day", 0)) == day and str(record.get("subject", "")) == subject:
			return true
	return false


func _format_number(value: int) -> String:
	var raw := str(maxi(0, value))
	var parts: Array[String] = []
	while raw.length() > 3:
		parts.push_front(raw.substr(raw.length() - 3, 3))
		raw = raw.substr(0, raw.length() - 3)
	parts.push_front(raw)
	var formatted := parts[0]
	for index in range(1, parts.size()):
		formatted += "," + parts[index]
	return formatted
