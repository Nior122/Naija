class_name CareerPanel
extends VBoxContainer

signal career_action_requested(action: String, payload: Dictionary)

const TEXT_DARK := Color("#27352b")
const TEXT_MUTED := Color("#657466")
const GREEN := Color("#39734a")
const LIGHT_GREEN := Color("#e6eee2")

var _character: Dictionary = {}
var _profile: Dictionary = {}
var _jobs: Array = []
var _online := false
var _busy := false
var _search_text := ""
var _notice := ""
var _search_input: LineEdit


func configure(
	character: Dictionary,
	career_profile: Dictionary,
	is_online: bool,
	world_date: Dictionary,
	minute_of_day: int,
	weekday: String
) -> void:
	_character = character.duplicate(true)
	_character["world_date"] = world_date.duplicate(true)
	_character["minute_of_day"] = minute_of_day
	_character["weekday"] = weekday
	_profile = career_profile.duplicate(true)
	_online = is_online
	_render()


func request_initial_search() -> void:
	if _online:
		_emit_action("search_jobs", {"text": _search_text})


func apply_server_response(message: Dictionary) -> void:
	_busy = false
	var response_type := str(message.get("type", ""))
	var profile: Variant = message.get("career_profile", {})
	if profile is Dictionary and not profile.is_empty():
		_profile = profile.duplicate(true)
	if response_type == "career.error":
		_notice = str(message.get("message", "The server rejected this career request."))
		_render()
		return
	if response_type != "career.result":
		return
	var action := str(message.get("action", ""))
	var data: Variant = message.get("data", {})
	if not data is Dictionary:
		_notice = "The server response did not include a career record."
		_render()
		return
	if action == "search_jobs":
		var rows: Variant = data.get("jobs", [])
		_jobs = rows.duplicate(true) if rows is Array else []
		_search_text = _search_input.text if is_instance_valid(_search_input) else _search_text
		_notice = str(message.get("message", "Vacancy search completed."))
	else:
		var updated_profile: Variant = data.get("career_profile", {})
		if updated_profile is Dictionary:
			_profile = updated_profile.duplicate(true)
		_notice = str(message.get("message", "Career record updated by the server."))
	_render()
	if _online and action != "search_jobs":
		_emit_action("search_jobs", {"text": _search_text})


func show_transport_error(message: String) -> void:
	_busy = false
	_notice = message
	_render()


func update_profile(career_profile: Dictionary) -> void:
	var search_focused := is_instance_valid(_search_input) and _search_input.has_focus()
	if search_focused:
		_search_text = _search_input.text
	_profile = career_profile.duplicate(true)
	if _busy or search_focused:
		return
	_render()


func update_world_context(
	character: Dictionary, world_date: Dictionary, minute_of_day: int, weekday: String
) -> void:
	var search_focused := is_instance_valid(_search_input) and _search_input.has_focus()
	if search_focused:
		_search_text = _search_input.text
	var changed := (
		int(_character.get("age", 0)) != int(character.get("age", 0))
		or str(_character.get("life_status", "")) != str(character.get("life_status", ""))
		or str(_character.get("current_location", "")) != str(character.get("current_location", ""))
		or int(_character.get("money", 0)) != int(character.get("money", 0))
		or int(_character.get("minute_of_day", -1)) != minute_of_day
		or str(_character.get("weekday", "")) != weekday
		or _date_key(_character.get("world_date", {})) != _date_key(world_date)
	)
	if not changed:
		return
	_character = character.duplicate(true)
	_character["world_date"] = world_date.duplicate(true)
	_character["minute_of_day"] = minute_of_day
	_character["weekday"] = weekday
	if _busy or search_focused:
		return
	_render()


func _render() -> void:
	for child in get_children():
		child.queue_free()
	_search_input = null
	if not _online:
		_add_text(
			"Career applications and payroll are available in the connected shared world only.",
			14,
			TEXT_DARK
		)
		_add_text(
			(
				"This keeps hiring, eligibility, work sessions and Naira salary records "
				+ "server-authoritative. No local placeholder job or fake success is shown."
			),
			12,
			TEXT_MUTED
		)
		return

	_add_text("Prototype vacancies and employer fixtures", 15, GREEN)
	_add_text(
		(
			"The sample employers are fictional Idera fixtures. Salary credits use "
			+ "the existing character balance; this is not a bank or a full economy."
		),
		12,
		TEXT_MUTED
	)
	if not _notice.is_empty():
		_add_text(_notice, 13, GREEN if not _busy else TEXT_MUTED)
	_add_text(
		"Existing character balance: ₦%s" % _format_number(int(_character.get("money", 0))),
		11,
		TEXT_DARK
	)

	_add_current_employment()
	_add_retirement_action()
	_add_vacancy_search()
	_add_vacancy_rows()
	_add_skills_and_history()


func _add_current_employment() -> void:
	_add_separator()
	_add_text("Current employment", 15, GREEN)
	var employment: Variant = _profile.get("current_employment", null)
	if not employment is Dictionary:
		_add_text("No active employment is recorded for this character.", 12, TEXT_MUTED)
		return

	var title := str(employment.get("job_title", employment.get("job_id", "Role")))
	_add_text(
		"%s  ·  %s" % [title, str(employment.get("employer_name_at_start", "Employer"))],
		14,
		TEXT_DARK
	)
	_add_text(
		(
			"Status: %s  ·  ₦%s monthly  ·  %s pay  ·  Performance %d/100"
			% [
				_format_status(str(employment.get("status", "active"))),
				_format_number(int(employment.get("salary_ngn_monthly", 0))),
				str(employment.get("pay_frequency", "monthly")),
				int(employment.get("performance_score", 0)),
			]
		),
		12,
		TEXT_DARK
	)
	_add_text(
		(
			"Workplace: %s  ·  Schedule: %s"
			% [
				_location_name(str(employment.get("work_location_id", ""))),
				str(
					(employment.get("schedule", {}) as Dictionary).get(
						"label", employment.get("work_schedule_id", "Not configured")
					)
				)
			]
		),
		12,
		TEXT_MUTED
	)

	var schedule: Dictionary = (
		employment.get("schedule", {}) if employment.get("schedule", {}) is Dictionary else {}
	)
	var session_id := str(employment.get("current_work_session_id", ""))
	var current_session := _find_session(session_id)
	if not session_id.is_empty() and not current_session.is_empty():
		_add_text(
			(
				"A server-recorded shift is in progress for %s."
				% _format_date(current_session.get("world_date", {}))
			),
			12,
			TEXT_DARK
		)
		var same_workplace := (
			str(_character.get("current_location", ""))
			== str(current_session.get("workplace_location_id", ""))
		)
		var elapsed := (
			int(_character.get("minute_of_day", 0))
			- int(current_session.get("started_at_minute", 0))
		)
		var minimum_minutes := int(schedule.get("minimum_session_minutes", 60))
		var end_minute := int(current_session.get("scheduled_end_minute", 1440))
		if (
			same_workplace
			and elapsed >= minimum_minutes
			and (
				int(_character.get("minute_of_day", 0))
				<= end_minute + int(schedule.get("clock_in_grace_minutes", 0))
			)
		):
			_add_action_button(
				"Complete work session",
				"complete_shift",
				{},
				"Complete the current server-recorded shift."
			)
		elif not same_workplace:
			_add_text("Return to the workplace to complete this shift.", 11, TEXT_MUTED)
		else:
			_add_text(
				(
					"The minimum session is %d minutes; %d minutes have elapsed."
					% [minimum_minutes, maxi(0, elapsed)]
				),
				11,
				TEXT_MUTED
			)
	elif str(employment.get("status", "")) == "active":
		var at_workplace := (
			str(_character.get("current_location", ""))
			== str(employment.get("work_location_id", ""))
		)
		if at_workplace and _is_scheduled_now(schedule):
			_add_action_button(
				"Clock in for today's shift",
				"start_shift",
				{},
				"Start a work session at this workplace."
			)
		elif not at_workplace:
			_add_text(
				(
					"Travel to %s to clock in."
					% _location_name(str(employment.get("work_location_id", "")))
				),
				11,
				TEXT_MUTED
			)
		else:
			_add_text("No shift is scheduled for this weekday or clock-in window.", 11, TEXT_MUTED)

	var leave_requests: Variant = _profile.get("leave_requests", [])
	if (
		str(employment.get("status", "")) == "active"
		and session_id.is_empty()
		and not _has_leave_today(leave_requests)
	):
		_add_action_button(
			"Request one unpaid personal-leave day",
			"request_leave",
			{
				"employment_id": str(employment.get("employment_id", "")),
				"leave_type": "personal",
				"start_date": _character.get("world_date", {}),
				"days": 1,
			},
			"The prototype policy records this one-day leave as approved and unpaid."
		)
	if bool(employment.get("promotion_available", false)):
		_add_action_button(
			"Request promotion to %s" % str(employment.get("promotion_job_title", "next role")),
			"request_promotion",
			{"employment_id": str(employment.get("employment_id", ""))},
			"The server checks the promotion requirements and same-employer opening again."
		)
	if str(employment.get("status", "")) in ["active", "on_leave", "suspended"]:
		_add_action_button(
			"Resign from this employment",
			"resign",
			{"employment_id": str(employment.get("employment_id", ""))},
			"Resignation closes the record and reconciles completed eligible sessions."
		)


func _add_retirement_action() -> void:
	var minimum_age := int(_profile.get("retirement_minimum_age", 60))
	if (
		int(_character.get("age", 0)) >= minimum_age
		and str(_character.get("life_status", "alive")) == "alive"
	):
		_add_action_button(
			"Record retirement at age %d+" % minimum_age,
			"retire",
			{},
			(
				"The Stage 5 life service verifies age. Active roles close unless their "
				+ "catalogue permits retired workers."
			)
		)


func _add_vacancy_search() -> void:
	_add_separator()
	_add_text("Search open vacancies", 15, GREEN)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	add_child(row)
	_search_input = LineEdit.new()
	_search_input.placeholder_text = "Role, employer or keyword"
	_search_input.text = _search_text
	_search_input.max_length = 80
	_search_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_search_input)
	var search_button := Button.new()
	search_button.text = "Search"
	search_button.disabled = _busy
	search_button.pressed.connect(_search_pressed)
	row.add_child(search_button)
	if _jobs.is_empty():
		_add_text(
			"No vacancy results are loaded yet. Search to request current server data.",
			11,
			TEXT_MUTED
		)


func _add_vacancy_rows() -> void:
	for entry_value in _jobs:
		if not entry_value is Dictionary:
			continue
		var entry: Dictionary = entry_value
		var section := VBoxContainer.new()
		section.add_theme_constant_override("separation", 4)
		section.add_theme_stylebox_override("panel", _card_style())
		var card := PanelContainer.new()
		card.add_theme_stylebox_override("panel", _card_style())
		card.add_child(section)
		add_child(card)
		var salary := int(entry.get("monthly_salary_offer_ngn", 0))
		_add_text(
			"%s" % str(entry.get("title", entry.get("job_id", "Role"))), 14, TEXT_DARK, section
		)
		_add_text(
			(
				"%s  ·  %s  ·  ₦%s/month (%s)  ·  %d opening(s)"
				% [
					str(entry.get("employer_name", "Independent work")),
					str(entry.get("industry_label", "Industry")),
					_format_number(salary),
					str(entry.get("pay_frequency", "monthly")),
					int(entry.get("openings_remaining", 0)),
				]
			),
			11,
			TEXT_MUTED,
			section
		)
		_add_text(str(entry.get("description", "")), 11, TEXT_DARK, section)
		var schedule: Variant = entry.get("schedule", {})
		if schedule is Dictionary:
			_add_text(
				(
					"%s  ·  %s  ·  %d hours/week"
					% [
						str(schedule.get("label", "Schedule")),
						", ".join(PackedStringArray(schedule.get("working_weekdays", []))),
						int(schedule.get("weekly_hours", 0)),
					]
				),
				11,
				TEXT_MUTED,
				section
			)
		var missing: Variant = entry.get("missing_requirements", [])
		if missing is Array and not missing.is_empty():
			_add_text(
				"Requirements not met: %s" % "; ".join(PackedStringArray(missing)),
				11,
				Color("#8a4c36"),
				section
			)
		else:
			_add_text(
				(
					"Server eligibility: currently meets the configured age, Stage 4 qualification, "
					+ "skill and vacancy checks."
				),
				11,
				GREEN,
				section
			)
		var application_status := str(entry.get("application_status", ""))
		if application_status in ["under_review", "submitted", "interview_requested"]:
			_add_action_button(
				"Withdraw pending application",
				"withdraw_application",
				{"application_id": _pending_application_id(str(entry.get("vacancy_id", "")))},
				"Withdraw this undecided application.",
				section
			)
		elif (
			bool(entry.get("eligible", false))
			and int(entry.get("openings_remaining", 0)) > 0
			and not _busy
		):
			_add_action_button(
				"Apply",
				"apply",
				{"vacancy_id": str(entry.get("vacancy_id", ""))},
				"Submit this application for server review.",
				section
			)
		elif application_status == "accepted":
			_add_text(
				"An accepted application is already recorded for this vacancy.",
				11,
				TEXT_MUTED,
				section
			)
		else:
			_add_text(
				"Application is unavailable until all current requirements are met.",
				11,
				TEXT_MUTED,
				section
			)


func _add_skills_and_history() -> void:
	_add_separator()
	_add_text("Skills and recorded history", 15, GREEN)
	var skills: Variant = _profile.get("skills", [])
	if skills is Array and not skills.is_empty():
		var skill_names: Array[String] = []
		for skill_value in skills.slice(0, mini(8, skills.size())):
			if skill_value is Dictionary:
				skill_names.append(
					(
						"%s L%d"
						% [
							str(skill_value.get("name", skill_value.get("skill_id", "Skill"))),
							int(skill_value.get("level", 0))
						]
					)
				)
		_add_text(
			(
				"Skills: %s"
				% (", ".join(skill_names) if not skill_names.is_empty() else "None recorded")
			),
			11,
			TEXT_DARK
		)
	else:
		_add_text("No Stage 4 or career skill records are available yet.", 11, TEXT_MUTED)

	var sessions: Variant = _profile.get("work_sessions", [])
	if sessions is Array and not sessions.is_empty():
		_add_text("Recent work sessions", 12, TEXT_DARK)
		for session_value in sessions.slice(0, mini(4, sessions.size())):
			if session_value is Dictionary:
				_add_text(
					(
						"%s  ·  %s  ·  %s  ·  ₦%s gross"
						% [
							_format_date(session_value.get("world_date", {})),
							str(session_value.get("job_id", "Role")),
							_format_status(str(session_value.get("status", ""))),
							_format_number(int(session_value.get("gross_earned_ngn", 0))),
						]
					),
					11,
					TEXT_MUTED
				)
	var payments: Variant = _profile.get("salary_payments", [])
	if payments is Array and not payments.is_empty():
		_add_text("Salary credits", 12, TEXT_DARK)
		for payment_value in payments.slice(0, mini(4, payments.size())):
			if payment_value is Dictionary:
				_add_text(
					(
						"%s  ·  ₦%s  ·  %s"
						% [
							_format_date(payment_value.get("paid_at_world_date", {})),
							_format_number(int(payment_value.get("amount_ngn", 0))),
							(
								"final settlement"
								if bool(payment_value.get("final_payment", false))
								else str(payment_value.get("pay_frequency", "salary"))
							),
						]
					),
					11,
					TEXT_MUTED
				)
	var reviews: Variant = _profile.get("performance_reviews", [])
	if reviews is Array and not reviews.is_empty():
		_add_text(
			(
				"Most recent review: %s"
				% str(reviews[0].get("summary", "Recorded performance review."))
			),
			11,
			TEXT_MUTED
		)

	var occupations: Variant = _profile.get("household_occupations", [])
	if occupations is Array and not occupations.is_empty():
		_add_text("Household NPC occupation foundations", 12, TEXT_DARK)
		for occupation_value in occupations.slice(0, mini(4, occupations.size())):
			if occupation_value is Dictionary:
				var job_title := str(occupation_value.get("job_title", ""))
				_add_text(
					(
						"%s  ·  %s"
						% [
							str(occupation_value.get("name", "Household member")),
							(
								job_title
								if not job_title.is_empty()
								else _format_status(
									str(occupation_value.get("status", "unemployed"))
								)
							),
						]
					),
					11,
					TEXT_MUTED
				)

	var licenses: Variant = _profile.get("licenses", [])
	if licenses is Array and not licenses.is_empty():
		_add_text("Server-recorded professional registrations", 12, TEXT_DARK)
		for license_value in licenses.slice(0, mini(4, licenses.size())):
			if license_value is Dictionary:
				_add_text(
					(
						"%s  ·  %s"
						% [
							str(license_value.get("license_id", "Registration")),
							_format_status(str(license_value.get("status", "active")))
						]
					),
					11,
					TEXT_MUTED
				)


func _search_pressed() -> void:
	_search_text = _search_input.text.strip_edges() if is_instance_valid(_search_input) else ""
	_emit_action("search_jobs", {"text": _search_text})


func _emit_action(action: String, payload: Dictionary) -> void:
	if not _online or _busy:
		return
	_busy = true
	_notice = "Waiting for the shared career service…"
	_render()
	career_action_requested.emit(action, payload.duplicate(true))


func _add_action_button(
	label_text: String,
	action: String,
	payload: Dictionary,
	description: String,
	parent: Node = null
) -> void:
	var target: Node = self if parent == null else parent
	_add_text(description, 10, TEXT_MUTED, target)
	var button := Button.new()
	button.text = label_text
	button.disabled = _busy
	button.custom_minimum_size = Vector2(180.0, 34.0)
	button.pressed.connect(func(): _emit_action(action, payload))
	target.add_child(button)


func _is_scheduled_now(schedule: Dictionary) -> bool:
	var weekdays: Variant = schedule.get("working_weekdays", [])
	if not weekdays is Array or not weekdays.has(str(_character.get("weekday", ""))):
		return false
	var minute := int(_character.get("minute_of_day", 0))
	var start := int(schedule.get("start_minute", 0))
	var end := int(schedule.get("end_minute", 1440))
	var minimum := int(schedule.get("minimum_session_minutes", 60))
	var latest_start := (
		end - minimum
		if bool(schedule.get("flexible", false))
		else start + int(schedule.get("clock_in_grace_minutes", 0))
	)
	return minute >= start and minute <= latest_start and minute < end


func _has_leave_today(value: Variant) -> bool:
	if not value is Array:
		return false
	var today := _character.get("world_date", {})
	for leave_value in value:
		if (
			not leave_value is Dictionary
			or str(leave_value.get("status", "")) not in ["pending", "approved"]
		):
			continue
		var start: Variant = leave_value.get("start_date", {})
		var end: Variant = leave_value.get("end_date", {})
		if (
			start is Dictionary
			and end is Dictionary
			and _date_key(start) <= _date_key(today)
			and _date_key(end) >= _date_key(today)
		):
			return true
	return false


func _find_session(session_id: String) -> Dictionary:
	if session_id.is_empty():
		return {}
	var sessions: Variant = _profile.get("work_sessions", [])
	if sessions is Array:
		for session_value in sessions:
			if (
				session_value is Dictionary
				and str(session_value.get("session_id", "")) == session_id
			):
				return session_value
	return {}


func _pending_application_id(vacancy_id: String) -> String:
	var applications: Variant = _profile.get("applications", [])
	if applications is Array:
		for application_value in applications:
			if (
				application_value is Dictionary
				and str(application_value.get("vacancy_id", "")) == vacancy_id
				and (
					str(application_value.get("status", ""))
					in ["under_review", "submitted", "interview_requested"]
				)
			):
				return str(application_value.get("application_id", ""))
	return ""


func _add_text(
	text_value: String, size: int = 12, color: Color = TEXT_DARK, parent: Node = null
) -> Label:
	var target: Node = self if parent == null else parent
	var label := Label.new()
	label.text = text_value
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	target.add_child(label)
	return label


func _add_separator() -> void:
	add_child(HSeparator.new())


func _card_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = LIGHT_GREEN
	style.border_color = Color("#a6b8a0")
	style.set_border_width_all(1)
	style.set_corner_radius_all(8)
	style.content_margin_left = 10.0
	style.content_margin_top = 8.0
	style.content_margin_right = 10.0
	style.content_margin_bottom = 8.0
	return style


func _format_status(value: String) -> String:
	return value.replace("_", " ").capitalize()


func _format_number(value: int) -> String:
	var digits := str(maxi(0, value))
	var grouped := ""
	for index in range(digits.length()):
		if index > 0 and (digits.length() - index) % 3 == 0:
			grouped += ","
		grouped += digits.substr(index, 1)
	return grouped


func _format_date(value: Variant) -> String:
	if not value is Dictionary:
		return "date unavailable"
	return (
		"%04d-%02d-%02d"
		% [int(value.get("year", 0)), int(value.get("month", 0)), int(value.get("day", 0))]
	)


func _date_key(value: Dictionary) -> String:
	return (
		"%04d-%02d-%02d"
		% [int(value.get("year", 0)), int(value.get("month", 0)), int(value.get("day", 0))]
	)


func _location_name(value: String) -> String:
	var labels := {
		"home": "Home / independent work",
		"market": "Community Market",
		"clinic": "Community Clinic",
		"schoolyard": "School yard",
		"campus": "Tertiary campus",
		"training_center": "Skills centre",
		"community_hall": "Community hall",
		"town": "Town",
	}
	return str(labels.get(value, value.replace("_", " ").capitalize()))
