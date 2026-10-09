class_name LifeSimulationService
extends RefCounted

const CATALOG_PATH: String = "res://data/life/life_catalog.json"
const MARRIAGE_STAGES: Array[String] = ["meet", "get_to_know", "dating", "commitment", "marriage"]
const DEATH_CAUSES: Array[String] = [
	"old_age", "illness", "accident", "violence", "poisoning_or_exposure", "other"
]
const CHILD_NAMES: Array[String] = [
	"Ayo", "Tobi", "Nneka", "Amara", "Femi", "Chidi", "Zainab", "Kene"
]

static var _catalog_cache: Dictionary = {}


static func catalog() -> Dictionary:
	if _catalog_cache.is_empty():
		if not FileAccess.file_exists(CATALOG_PATH):
			push_error("The Stage 5 life catalog is missing: %s" % CATALOG_PATH)
			return {}
		var file := FileAccess.open(CATALOG_PATH, FileAccess.READ)
		if file == null:
			push_error("The Stage 5 life catalog could not be opened.")
			return {}
		var parsed: Variant = JSON.parse_string(file.get_as_text())
		file.close()
		if not parsed is Dictionary or int(parsed.get("schema_version", 0)) != 1:
			push_error("The Stage 5 life catalog is invalid.")
			return {}
		_catalog_cache = parsed
	return _catalog_cache.duplicate(true)


static func default_world_date() -> Dictionary:
	return (
		catalog()
		. get("calendar", {})
		. get("epoch_world_date", {"year": 2025, "month": 1, "day": 1})
		. duplicate(true)
	)


static func is_leap_year(year: int) -> bool:
	return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


static func days_in_month(year: int, month: int) -> int:
	if month < 1 or month > 12:
		return 0
	if month == 2:
		return 29 if is_leap_year(year) else 28
	return 30 if month in [4, 6, 9, 11] else 31


static func valid_date(value: Variant) -> bool:
	if not value is Dictionary:
		return false
	var year := int(value.get("year", 0))
	var month := int(value.get("month", 0))
	var day := int(value.get("day", 0))
	return (
		year >= 1
		and year <= 9999
		and month >= 1
		and month <= 12
		and day >= 1
		and day <= days_in_month(year, month)
	)


static func compare_dates(left: Dictionary, right: Dictionary) -> int:
	var left_key := (
		int(left.get("year", 0)) * 10000 + int(left.get("month", 0)) * 100 + int(left.get("day", 0))
	)
	var right_key := (
		int(right.get("year", 0)) * 10000
		+ int(right.get("month", 0)) * 100
		+ int(right.get("day", 0))
	)
	if left_key < right_key:
		return -1
	if left_key > right_key:
		return 1
	return 0


static func _unix_day(date: Dictionary) -> int:
	var datetime := {
		"year": int(date.get("year", 2025)),
		"month": int(date.get("month", 1)),
		"day": int(date.get("day", 1)),
		"hour": 0,
		"minute": 0,
		"second": 0,
	}
	return int(floor(float(Time.get_unix_time_from_datetime_dict(datetime)) / 86400.0))


static func _date_from_unix_day(day_number: int) -> Dictionary:
	var datetime: Dictionary = Time.get_datetime_dict_from_unix_time(day_number * 86400)
	return {
		"year": int(datetime.get("year", 2025)),
		"month": int(datetime.get("month", 1)),
		"day": int(datetime.get("day", 1)),
	}


static func add_days(date: Dictionary, count: int) -> Dictionary:
	if not valid_date(date):
		return default_world_date()
	return _date_from_unix_day(_unix_day(date) + count)


static func add_years_clamped(date: Dictionary, count: int) -> Dictionary:
	var year := int(date.get("year", 2025)) + count
	if year < 1 or year > 9999:
		return default_world_date()
	var month := int(date.get("month", 1))
	return {
		"year": year,
		"month": month,
		"day": mini(int(date.get("day", 1)), days_in_month(year, month))
	}


static func birthday_date_for_year(date_of_birth: Dictionary, year: int) -> Dictionary:
	var month := int(date_of_birth.get("month", 1))
	return {
		"year": year,
		"month": month,
		"day": mini(int(date_of_birth.get("day", 1)), days_in_month(year, month))
	}


static func age_on_date(date_of_birth: Dictionary, current_date: Dictionary) -> int:
	if (
		not valid_date(date_of_birth)
		or not valid_date(current_date)
		or compare_dates(date_of_birth, current_date) > 0
	):
		return 0
	var age := int(current_date.year) - int(date_of_birth.year)
	if (
		compare_dates(current_date, birthday_date_for_year(date_of_birth, int(current_date.year)))
		< 0
	):
		age -= 1
	return age


static func date_for_world_day(day: int) -> Dictionary:
	var calendar: Dictionary = catalog().get("calendar", {})
	var epoch: Dictionary = calendar.get("epoch_world_date", default_world_date())
	var first_day := maxi(1, int(calendar.get("starting_world_day", 1)))
	return add_days(epoch, maxi(0, day - first_day))


static func world_day_for_date(date: Dictionary) -> int:
	var calendar: Dictionary = catalog().get("calendar", {})
	var epoch: Dictionary = calendar.get("epoch_world_date", default_world_date())
	return _unix_day(date) - _unix_day(epoch) + int(calendar.get("starting_world_day", 1))


static func world_week(day: int) -> int:
	var calendar: Dictionary = catalog().get("calendar", {})
	var first_day := int(calendar.get("starting_world_day", 1))
	if day < first_day:
		return 0
	var weekdays: Array = calendar.get("weekday_names", [])
	var start_weekday := weekdays.find(str(calendar.get("week_starts_on", "Monday")))
	if start_weekday < 0:
		start_weekday = 0
	var epoch: Dictionary = calendar.get("epoch_world_date", default_world_date())
	var epoch_weekday := posmod(_unix_day(epoch) + 4, 7)
	var first_week_offset := posmod(epoch_weekday - start_weekday, 7)
	return int(floor(float(day - first_day + first_week_offset) / 7.0)) + 1


static func weekday_name(date: Dictionary) -> String:
	var names: Array = catalog().get("calendar", {}).get("weekday_names", [])
	var weekday := posmod(_unix_day(date) + 4, 7)
	return str(names[weekday]) if weekday < names.size() else "Unknown day"


static func date_label(date: Dictionary) -> String:
	var months: Array = catalog().get("calendar", {}).get("month_names", [])
	var month := int(date.get("month", 1))
	var month_name := (
		str(months[month - 1]) if month > 0 and month <= months.size() else "Unknown month"
	)
	return "%d %s %d" % [int(date.get("day", 1)), month_name, int(date.get("year", 2025))]


static func life_stage_for_age(age: int) -> Dictionary:
	var stages: Array = catalog().get("life_stages", [])
	for stage in stages:
		if age >= int(stage.get("min_age_years", 0)) and age <= int(stage.get("max_age_years", 0)):
			return stage.duplicate(true)
	return (
		stages.back().duplicate(true)
		if not stages.is_empty()
		else {"id": "unknown", "label": "Unknown"}
	)


static func is_adult_age(age: int) -> bool:
	var rules: Dictionary = catalog().get("relationship_rules", {})
	return (
		age >= int(rules.get("minimum_adult_age_years", 18))
		and bool(life_stage_for_age(age).get("adult_relationships_allowed", false))
	)


static func date_of_birth_for_age(current_date: Dictionary, age: int, seed: String) -> Dictionary:
	var anchored := add_years_clamped(current_date, -age)
	var offset := posmod(seed.hash(), 365)
	return add_days(anchored, -offset)


static func _person_id(person: Dictionary) -> String:
	return str(person.get("character_id", person.get("person_id", "")))


static func _life_event(
	person_id: String, event_type: String, date: Dictionary, summary: String, data: Dictionary = {}
) -> Dictionary:
	return {
		"id": "%s:%s" % [event_type, person_id],
		"type": event_type,
		"date": date.duplicate(true),
		"summary": summary,
		"data": data.duplicate(true),
	}


static func _append_history(history_value: Variant, event: Dictionary) -> Array[Dictionary]:
	var history: Array[Dictionary] = []
	if history_value is Array:
		for entry in history_value:
			if entry is Dictionary:
				history.append(entry.duplicate(true))
	var event_id := str(event.get("id", ""))
	for existing in history:
		if str(existing.get("id", "")) == event_id:
			return history
	history.append(event.duplicate(true))
	return history


static func _relationship_key(type: String, first_id: String, second_id: String) -> String:
	var ids := [first_id, second_id]
	if type not in ["parent_of", "guardian_of"]:
		ids.sort()
	return "relationship:%s:%s:%s" % [type, ids[0], ids[1]]


static func _relationship_by_id(person: Dictionary, relationship_id: String) -> Dictionary:
	var relationships: Variant = person.get("relationships", [])
	if relationships is Array:
		for relationship in relationships:
			if (
				relationship is Dictionary
				and str(relationship.get("relationship_id", "")) == relationship_id
			):
				return relationship.duplicate(true)
	return {}


static func _append_unique_people(
	people: Array[Dictionary], seen: Dictionary, source_value: Variant
) -> void:
	if not source_value is Array:
		return
	for source_person in source_value:
		if not source_person is Dictionary:
			continue
		var person_id := str(
			source_person.get(
				"person_id", source_person.get("character_id", source_person.get("id", ""))
			)
		)
		if person_id.is_empty() or seen.has(person_id):
			continue
		var person: Dictionary = source_person.duplicate(true)
		person["person_id"] = person_id
		seen[person_id] = true
		people.append(person)


static func _append_unique_edges(
	edges: Array[Dictionary], seen: Dictionary, source_value: Variant
) -> void:
	if not source_value is Array:
		return
	for source_edge in source_value:
		if not source_edge is Dictionary:
			continue
		var participants: Variant = source_edge.get("participants", [])
		var edge_type := str(source_edge.get("type", "relationship"))
		var edge_id := str(source_edge.get("relationship_id", "%s:%s" % [edge_type, participants]))
		if seen.has(edge_id):
			continue
		seen[edge_id] = true
		edges.append(source_edge.duplicate(true))


static func _store_relationship(person: Dictionary, relationship: Dictionary) -> void:
	var relationships: Array = person.get("relationships", []).duplicate(true)
	var relationship_id := str(relationship.get("relationship_id", ""))
	var replaced := false
	for index in range(relationships.size()):
		if (
			relationships[index] is Dictionary
			and str(relationships[index].get("relationship_id", "")) == relationship_id
		):
			relationships[index] = relationship.duplicate(true)
			replaced = true
			break
	if not replaced:
		relationships.append(relationship.duplicate(true))
	person["relationships"] = relationships


static func process_person_to_date(
	person_value: Dictionary, through_date: Dictionary
) -> Dictionary:
	var person := person_value.duplicate(true)
	if not valid_date(through_date):
		return person
	var id := _person_id(person)
	if id.is_empty():
		id = "person"
	var dob: Dictionary = person.get("date_of_birth", {})
	if not valid_date(dob):
		var previous_age := clampi(int(person.get("age", 15)), 0, 9998)
		dob = date_of_birth_for_age(through_date, previous_age, id)
	person["date_of_birth"] = dob.duplicate(true)
	var status := str(person.get("life_status", "alive"))
	if status not in ["alive", "retired", "deceased"]:
		status = "alive"
	person["life_status"] = status
	var last_date: Dictionary = person.get("last_life_processed_date", {})
	if not valid_date(last_date):
		last_date = through_date.duplicate(true)
	var life_through_date := through_date
	var death_date: Variant = person.get("death_date", null)
	if status == "deceased" and death_date is Dictionary and valid_date(death_date):
		life_through_date = death_date
	elif compare_dates(last_date, life_through_date) > 0:
		life_through_date = last_date.duplicate(true)
	var history: Array[Dictionary] = []
	var raw_history: Variant = person.get("life_history", [])
	if raw_history is Array:
		for entry in raw_history:
			if entry is Dictionary:
				history.append(entry.duplicate(true))
	if status != "deceased" and compare_dates(last_date, life_through_date) < 0:
		var start_year := maxi(int(dob.year), int(last_date.year))
		for year in range(start_year, int(life_through_date.year) + 1):
			var anniversary := birthday_date_for_year(dob, year)
			if (
				compare_dates(anniversary, last_date) <= 0
				or compare_dates(anniversary, life_through_date) > 0
			):
				continue
			var birthday_age := age_on_date(dob, anniversary)
			var birthday_id := "birthday:%s:%d" % [id, year]
			var birthday := {
				"id": birthday_id,
				"type": "birthday",
				"date": anniversary,
				"summary": "Birthday recorded: age %d." % birthday_age,
				"age": birthday_age,
			}
			history = _append_history(history, birthday)
			var previous_stage := life_stage_for_age(maxi(0, birthday_age - 1))
			var next_stage := life_stage_for_age(birthday_age)
			if str(previous_stage.get("id", "")) != str(next_stage.get("id", "")):
				var transition := {
					"id": "life-stage:%s:%d:%s" % [id, year, str(next_stage.get("id", ""))],
					"type": "life_stage_changed",
					"date": anniversary,
					"summary":
					"Life stage changed to %s." % str(next_stage.get("label", "Unknown")),
					"from_stage": str(previous_stage.get("id", "")),
					"to_stage": str(next_stage.get("id", "")),
				}
				history = _append_history(history, transition)
	person["age"] = age_on_date(dob, life_through_date)
	person["life_stage_id"] = str(life_stage_for_age(int(person.age)).get("id", "unknown"))
	person["life_history"] = history
	if compare_dates(last_date, life_through_date) < 0:
		person["last_life_processed_date"] = life_through_date.duplicate(true)
	else:
		person["last_life_processed_date"] = last_date.duplicate(true)
	return person


static func new_family_person(
	person_id: String,
	person_name: String,
	age: int,
	family_role: String,
	world_date: Dictionary,
	household_id: String,
	family_id: String,
	home_id: String
) -> Dictionary:
	var dob := date_of_birth_for_age(world_date, age, person_id)
	return {
		"person_id": person_id,
		"name": person_name,
		"age": age_on_date(dob, world_date),
		"date_of_birth": dob,
		"life_stage_id": str(life_stage_for_age(age).get("id", "unknown")),
		"life_status": "alive",
		"family_role": family_role,
		"household_id": household_id,
		"family_ids": [family_id],
		"home_id": home_id,
		"current_location": "home",
		"education_level": "Secondary education (NPC record)" if age < 18 else "Not recorded (NPC)",
		"life_history": [],
		"relationships": [],
		"inheritance_event_ids": [],
		"last_life_processed_date": world_date.duplicate(true),
		"is_player_controlled": false,
	}


static func initialize_character_life(
	character_id: String,
	character_name: String,
	starting_age: int,
	world_date: Dictionary,
	household: Dictionary
) -> Dictionary:
	var family_id := str(household.get("family_id", ""))
	var household_id := str(household.get("id", ""))
	var dob := date_of_birth_for_age(world_date, starting_age, character_id)
	var life_history: Array[Dictionary] = []
	(
		life_history
		. append(
			{
				"id": "character-created:%s" % character_id,
				"type": "character_created",
				"date": world_date.duplicate(true),
				"summary": "%s began a life in the local world." % character_name,
				"age": starting_age,
			}
		)
	)
	var family_event := {
		"id": "family-created:%s" % family_id,
		"type": "family_created",
		"date": world_date.duplicate(true),
		"summary": "A persistent household with guardians and sibling was recorded.",
		"family_id": family_id,
	}
	life_history.append(family_event)
	var family_members: Array = household.get("family_members", [])
	for index in range(family_members.size()):
		if not family_members[index] is Dictionary:
			continue
		var family_person: Dictionary = family_members[index].duplicate(true)
		family_person["life_history"] = _append_history(
			family_person.get("life_history", []), family_event
		)
		family_members[index] = family_person
	household["family_members"] = family_members
	var relationships: Array[Dictionary] = []
	var edges: Array[Dictionary] = []
	var member_ids: Array[String] = [character_id]
	for relative in family_members:
		if not relative is Dictionary:
			continue
		var relative_id := _person_id(relative)
		if relative_id.is_empty():
			continue
		member_ids.append(relative_id)
		var role := str(relative.get("family_role", "relative"))
		var relation_type := "sibling_of"
		var participants := [character_id, relative_id]
		if role == "parent":
			relation_type = "parent_of"
			participants = [relative_id, character_id]
		elif role == "guardian":
			relation_type = "guardian_of"
			participants = [relative_id, character_id]
		var relation := {
			"relationship_id":
			"family:%s:%s:%s" % [relation_type, participants[0], participants[1]],
			"type": relation_type,
			"participants": participants,
			"status": "active",
			"created_world_date": world_date.duplicate(true),
			"event_ids": ["family-created:%s" % family_id],
		}
		relationships.append(relation)
		edges.append(relation.duplicate(true))
	var family_tree := {
		"family_id": family_id,
		"family_name": str(household.get("family_name", "Family")),
		"member_ids": member_ids,
		"members": family_members.duplicate(true),
		"relationships": edges,
		"parent_family_ids": [],
	}
	return {
		"date_of_birth": dob,
		"age": age_on_date(dob, world_date),
		"life_stage_id": str(life_stage_for_age(age_on_date(dob, world_date)).get("id", "unknown")),
		"life_status": "alive",
		"household_id": household_id,
		"family_ids": [family_id] if not family_id.is_empty() else [],
		"life_history": life_history,
		"relationships": relationships,
		"family_tree": family_tree,
		"inheritance_event_ids": [],
		"inheritance_events": [],
		"marriages": [],
		"last_life_processed_date": world_date.duplicate(true),
	}


static func process_household_to_date(
	household_value: Dictionary, world_date: Dictionary
) -> Dictionary:
	var household := household_value.duplicate(true)
	var members: Array = household.get("family_members", [])
	for index in range(members.size()):
		if members[index] is Dictionary:
			members[index] = process_person_to_date(members[index], world_date)
	household["family_members"] = members
	var guardians: Array[Dictionary] = []
	var siblings: Array[Dictionary] = []
	for person in members:
		if not person is Dictionary:
			continue
		var role := str(person.get("family_role", ""))
		if role in ["parent", "guardian"]:
			guardians.append(person.duplicate(true))
		elif role == "sibling":
			siblings.append(person.duplicate(true))
	household["guardians"] = guardians
	household["siblings"] = siblings
	var family_tree: Dictionary = household.get("family_tree", {})
	family_tree["members"] = members.duplicate(true)
	household["family_tree"] = family_tree
	return household


static func can_form_relationship(
	first: Dictionary, second: Dictionary, stage: String, world_date: Dictionary = {}
) -> String:
	var first_age := int(first.get("age", 0))
	var second_age := int(second.get("age", 0))
	if valid_date(world_date):
		first_age = age_on_date(first.get("date_of_birth", {}), world_date)
		second_age = age_on_date(second.get("date_of_birth", {}), world_date)
	if (
		str(first.get("life_status", "alive")) == "deceased"
		or str(second.get("life_status", "alive")) == "deceased"
	):
		return "character_deceased"
	if stage == "friendship":
		var rules: Dictionary = catalog().get("relationship_rules", {})
		if (
			(not is_adult_age(first_age) or not is_adult_age(second_age))
			and (
				abs(first_age - second_age)
				> int(rules.get("minor_friendship_max_age_gap_years", 4))
			)
		):
			return "minor_friendship_age_gap"
		return ""
	if stage not in MARRIAGE_STAGES or not is_adult_age(first_age) or not is_adult_age(second_age):
		return "relationship_age_restricted"
	return ""


static func propose_relationship(
	first: Dictionary,
	second: Dictionary,
	stage: String,
	world_date: Dictionary,
	household: Dictionary = {}
) -> Dictionary:
	if (
		stage != "friendship"
		and stage not in catalog().get("relationship_rules", {}).get("romantic_progression", [])
	):
		return {"ok": false, "error": "relationship_stage_invalid"}
	var first_id := _person_id(first)
	var second_id := _person_id(second)
	if first_id.is_empty() or second_id.is_empty() or first_id == second_id:
		return {"ok": false, "error": "relationship_partner_unavailable"}
	var restriction := can_form_relationship(first, second, stage, world_date)
	if not restriction.is_empty():
		return {"ok": false, "error": restriction}
	if stage != "friendship":
		for existing in first.get("relationships", []):
			if not existing is Dictionary:
				continue
			if str(existing.get("type", "")) in ["parent_of", "guardian_of", "sibling_of"]:
				var participants: Array = existing.get("participants", [])
				if participants.has(first_id) and participants.has(second_id):
					return {"ok": false, "error": "relationship_close_family_restricted"}
	var relation_type := "friendship" if stage == "friendship" else "romantic"
	var relationship_id := _relationship_key(relation_type, first_id, second_id)
	var relationship := _relationship_by_id(first, relationship_id)
	if relationship.is_empty():
		relationship = _relationship_by_id(second, relationship_id)
	if not relationship.is_empty() and str(relationship.get("status", "")) in ["ended", "bereaved"]:
		return {"ok": false, "error": "relationship_cannot_resume"}
	if stage == "friendship":
		if not relationship.is_empty() and str(relationship.get("status", "")) == "active":
			return {"ok": false, "error": "relationship_already_active"}
	else:
		var progression: Array = catalog().get("relationship_rules", {}).get(
			"romantic_progression", []
		)
		var current_index := (
			progression.find(str(relationship.get("stage", "")))
			if not relationship.is_empty()
			else -1
		)
		var expected_stage := (
			str(progression[current_index + 1]) if current_index + 1 < progression.size() else ""
		)
		if stage != expected_stage:
			return {"ok": false, "error": "relationship_stage_order"}
	if relationship.is_empty():
		relationship = {
			"relationship_id": relationship_id,
			"type": relation_type,
			"participants":
			[first_id, second_id] if first_id < second_id else [second_id, first_id],
			"status": "pending",
			"created_world_date": world_date.duplicate(true),
			"updated_world_date": world_date.duplicate(true),
			"event_ids": [],
			"pending_stage": stage,
			"pending_by": first_id,
		}
		_store_relationship(first, relationship)
		_store_relationship(second, relationship)
		return {
			"ok": true,
			"status": "pending",
			"relationship": relationship.duplicate(true),
			"person": first.duplicate(true),
			"partner": second.duplicate(true),
		}
	if str(relationship.get("status", "")) == "active":
		relationship["status"] = "pending"
		relationship["pending_stage"] = stage
		relationship["pending_by"] = first_id
		relationship["updated_world_date"] = world_date.duplicate(true)
		_store_relationship(first, relationship)
		_store_relationship(second, relationship)
		return {
			"ok": true,
			"status": "pending",
			"relationship": relationship.duplicate(true),
			"person": first.duplicate(true),
			"partner": second.duplicate(true),
		}
	if str(relationship.get("pending_stage", "")) != stage:
		return {"ok": false, "error": "relationship_stage_pending"}
	if str(relationship.get("pending_by", "")) == first_id:
		return {"ok": false, "error": "relationship_waiting_for_partner"}
	relationship["status"] = "active"
	relationship["stage"] = stage
	relationship["updated_world_date"] = world_date.duplicate(true)
	relationship.erase("pending_stage")
	relationship.erase("pending_by")
	var event_id := "relationship:%s:%s" % [relationship_id, stage]
	var event := {
		"id": event_id,
		"type": "friendship_started" if stage == "friendship" else "relationship_stage_changed",
		"date": world_date.duplicate(true),
		"summary":
		(
			"A friendship was recorded by mutual confirmation."
			if stage == "friendship"
			else "Adult relationship progression reached %s." % stage.replace("_", " ")
		),
		"data": {"relationship_id": relationship_id, "stage": stage},
	}
	for person in [first, second]:
		person["life_history"] = _append_history(person.get("life_history", []), event)
	var event_ids: Array = relationship.get("event_ids", []).duplicate(true)
	if not event_ids.has(event_id):
		event_ids.append(event_id)
	relationship["event_ids"] = event_ids
	_store_relationship(first, relationship)
	_store_relationship(second, relationship)
	var marriage: Dictionary = {}
	var resulting_household: Dictionary = {}
	if stage == "marriage":
		var marriage_result := record_marriage(first, second, world_date, household)
		if not bool(marriage_result.get("ok", false)):
			return marriage_result
		marriage = marriage_result.get("marriage", {})
		resulting_household = marriage_result.get("household", {}).duplicate(true)
		relationship["marriage_id"] = str(marriage.get("marriage_id", ""))
		_store_relationship(first, relationship)
		_store_relationship(second, relationship)
	var result := {
		"ok": true,
		"status": "confirmed",
		"relationship": relationship.duplicate(true),
		"person": first.duplicate(true),
		"partner": second.duplicate(true),
	}
	if not marriage.is_empty():
		result["marriage"] = marriage.duplicate(true)
	if not resulting_household.is_empty():
		result["household"] = resulting_household
	return result


static func record_marriage(
	first: Dictionary, second: Dictionary, world_date: Dictionary, household: Dictionary
) -> Dictionary:
	var restriction := can_form_relationship(first, second, "marriage", world_date)
	if not restriction.is_empty():
		return {"ok": false, "error": restriction}
	var first_id := _person_id(first)
	var second_id := _person_id(second)
	if first_id.is_empty() or second_id.is_empty() or first_id == second_id:
		return {"ok": false, "error": "relationship_partner_unavailable"}
	for existing_relationship in first.get("relationships", []):
		if not existing_relationship is Dictionary:
			continue
		if str(existing_relationship.get("type", "")) in ["parent_of", "guardian_of", "sibling_of"]:
			var participants: Array = existing_relationship.get("participants", [])
			if participants.has(first_id) and participants.has(second_id):
				return {"ok": false, "error": "relationship_close_family_restricted"}
	for existing_marriage in first.get("marriages", []):
		if (
			not existing_marriage is Dictionary
			or str(existing_marriage.get("status", "")) != "active"
		):
			continue
		var spouses: Array = existing_marriage.get("spouse_ids", [])
		if spouses.has(first_id) and spouses.has(second_id):
			return {
				"ok": true,
				"replayed": true,
				"marriage": existing_marriage.duplicate(true),
				"household": household.duplicate(true),
				"family_id": str(existing_marriage.get("family_id", "")),
			}
	var marriage_id := _new_id("marriage")
	var family_id := _new_id("family")
	var household_id := _new_id("household")
	var home_id := "home-" + household_id
	var family_ids: Array = []
	for family_id_value in first.get("family_ids", []):
		if not family_ids.has(family_id_value):
			family_ids.append(family_id_value)
	for family_id_value in second.get("family_ids", []):
		if not family_ids.has(family_id_value):
			family_ids.append(family_id_value)
	var marriage := {
		"marriage_id": marriage_id,
		"spouse_ids": [first_id, second_id],
		"world_date": world_date.duplicate(true),
		"family_id": family_id,
		"household_id": household_id,
		"status": "active",
	}
	for person in [first, second]:
		person["household_id"] = household_id
		person["home_id"] = home_id
		var ids: Array = person.get("family_ids", []).duplicate(true)
		if not ids.has(family_id):
			ids.append(family_id)
		person["family_ids"] = ids
		var marriages: Array = person.get("marriages", []).duplicate(true)
		marriages.append(marriage.duplicate(true))
		person["marriages"] = marriages
		var spouse_relationship := {
			"relationship_id": _relationship_key("spouse", first_id, second_id),
			"type": "spouse",
			"participants":
			[first_id, second_id] if first_id < second_id else [second_id, first_id],
			"status": "active",
			"created_world_date": world_date.duplicate(true),
			"marriage_id": marriage_id,
		}
		_store_relationship(person, spouse_relationship)
		person["life_history"] = _append_history(
			person.get("life_history", []),
			{
				"id": "marriage:%s" % marriage_id,
				"type": "marriage",
				"date": world_date.duplicate(true),
				"summary": "A marriage was recorded with linked spouse and family records.",
				"marriage_id": marriage_id,
			}
		)
	var shared_household := household.duplicate(true)
	shared_household["id"] = household_id
	shared_household["home_id"] = home_id
	shared_household["home_type"] = "Shared family household"
	shared_household["family_id"] = family_id
	shared_household["family_name"] = (
		"%s-%s" % [str(first.get("name", "Family")), str(second.get("name", "Family"))]
	)
	shared_household["family_ids"] = family_ids + [family_id]
	shared_household["member_ids"] = [first_id, second_id]
	shared_household["parent_family_ids"] = family_ids
	shared_household["created_world_date"] = world_date.duplicate(true)
	var household_members: Array[Dictionary] = []
	for person in [first, second]:
		var member: Dictionary = person.duplicate(true)
		member["person_id"] = _person_id(person)
		member["family_role"] = "spouse"
		member["is_player_controlled"] = false
		household_members.append(member)
	shared_household["family_members"] = household_members
	shared_household["members"] = household_members.duplicate(true)
	shared_household["guardians"] = []
	shared_household["siblings"] = []
	var spouse_relationship := {
		"relationship_id": _relationship_key("spouse", first_id, second_id),
		"type": "spouse",
		"participants": [first_id, second_id] if first_id < second_id else [second_id, first_id],
		"status": "active",
		"created_world_date": world_date.duplicate(true),
		"marriage_id": marriage_id,
	}
	var tree_members: Array[Dictionary] = []
	var seen_people: Dictionary = {}
	_append_unique_people(tree_members, seen_people, household_members)
	_append_unique_people(tree_members, seen_people, household.get("family_members", []))
	var family_tree_values: Array = [
		household.get("family_tree", {}),
		first.get("family_tree", {}),
		second.get("family_tree", {})
	]
	var tree_edges: Array[Dictionary] = []
	var seen_edges: Dictionary = {}
	for source_tree in family_tree_values:
		if not source_tree is Dictionary:
			continue
		_append_unique_people(
			tree_members, seen_people, source_tree.get("members", source_tree.get("people", []))
		)
		_append_unique_edges(tree_edges, seen_edges, source_tree.get("relationships", []))
	_append_unique_edges(tree_edges, seen_edges, first.get("relationships", []))
	_append_unique_edges(tree_edges, seen_edges, second.get("relationships", []))
	_append_unique_edges(tree_edges, seen_edges, [spouse_relationship])
	var tree_member_ids: Array[String] = []
	for member in tree_members:
		var member_id := _person_id(member)
		if not member_id.is_empty() and not tree_member_ids.has(member_id):
			tree_member_ids.append(member_id)
	var family_tree := {
		"family_id": family_id,
		"family_name": shared_household["family_name"],
		"parent_family_ids": family_ids,
		"member_ids": tree_member_ids,
		"members": tree_members,
		"relationships": tree_edges,
	}
	shared_household["family_tree"] = family_tree
	return {"ok": true, "marriage": marriage, "household": shared_household, "family_id": family_id}


static func record_childbirth(
	first_parent: Dictionary,
	second_parent: Dictionary,
	household_value: Dictionary,
	child_name: String,
	world_date: Dictionary,
	idempotency_key: String = ""
) -> Dictionary:
	var error := can_form_relationship(first_parent, second_parent, "marriage", world_date)
	if not error.is_empty():
		return {"ok": false, "error": error}
	var first_id := _person_id(first_parent)
	var second_id := _person_id(second_parent)
	var active_marriage: Dictionary = {}
	for marriage in first_parent.get("marriages", []):
		if not marriage is Dictionary or str(marriage.get("status", "")) != "active":
			continue
		var spouse_ids: Array = marriage.get("spouse_ids", [])
		if spouse_ids.has(first_id) and spouse_ids.has(second_id):
			active_marriage = marriage.duplicate(true)
			break
	if active_marriage.is_empty():
		return {"ok": false, "error": "marriage_not_active"}
	var household := household_value.duplicate(true)
	if (
		str(active_marriage.get("household_id", ""))
		!= str(household.get("id", household.get("household_id", "")))
	):
		return {"ok": false, "error": "marriage_household_mismatch"}
	var household_id := str(household.get("id", household.get("household_id", "")))
	if household_id.is_empty():
		return {"ok": false, "error": "household_missing"}
	if not idempotency_key.is_empty():
		var requests: Dictionary = household.get("life_action_requests", {})
		var existing_child_id := str(requests.get(idempotency_key, ""))
		if not existing_child_id.is_empty():
			for existing_child in household.get("family_members", []):
				if existing_child is Dictionary and _person_id(existing_child) == existing_child_id:
					return {
						"ok": true,
						"replayed": true,
						"child": existing_child.duplicate(true),
						"household": household,
					}
	var person_id := _new_id("npc")
	var generated_name := child_name.strip_edges()
	if generated_name.is_empty():
		generated_name = CHILD_NAMES[randi_range(0, CHILD_NAMES.size() - 1)]
	var family_id := str(household.get("family_id", ""))
	var family_ids: Array = household.get("family_ids", []).duplicate(true)
	if not family_ids.has(family_id) and not family_id.is_empty():
		family_ids.append(family_id)
	var child := new_family_person(
		person_id,
		generated_name,
		0,
		"child",
		world_date,
		household_id,
		family_id,
		str(household.get("home_id", ""))
	)
	child["date_of_birth"] = world_date.duplicate(true)
	child["age"] = 0
	child["last_life_processed_date"] = world_date.duplicate(true)
	child["birth_request_id"] = idempotency_key
	child["family_ids"] = family_ids
	child["life_history"] = [
		{
			"id": "childbirth:%s" % person_id,
			"type": "childbirth",
			"date": world_date.duplicate(true),
			"summary": "A child NPC was added to the family tree and household.",
		}
	]
	var members: Array = household.get("family_members", []).duplicate(true)
	members.append(child.duplicate(true))
	household["family_members"] = members
	var member_ids: Array = household.get("member_ids", []).duplicate(true)
	member_ids.append(person_id)
	household["member_ids"] = member_ids
	var tree: Dictionary = household.get("family_tree", {}).duplicate(true)
	var tree_members: Array = tree.get("members", []).duplicate(true)
	tree_members.append(child.duplicate(true))
	tree["members"] = tree_members
	var tree_ids: Array = tree.get("member_ids", []).duplicate(true)
	tree_ids.append(person_id)
	tree["member_ids"] = tree_ids
	var edges: Array = tree.get("relationships", []).duplicate(true)
	for parent in [first_parent, second_parent]:
		var parent_id := _person_id(parent)
		var parent_relationship := {
			"relationship_id": _relationship_key("parent_of", parent_id, person_id),
			"type": "parent_of",
			"participants": [parent_id, person_id],
			"status": "active",
			"created_world_date": world_date.duplicate(true),
		}
		edges.append(parent_relationship.duplicate(true))
		_store_relationship(parent, parent_relationship)
		parent["life_history"] = _append_history(
			parent.get("life_history", []),
			{
				"id": "childbirth:%s" % person_id,
				"type": "childbirth",
				"date": world_date.duplicate(true),
				"summary": "A child NPC was added to the family tree and household.",
				"child_id": person_id,
			}
		)
		var child_relationships: Array = child.get("relationships", []).duplicate(true)
		child_relationships.append(parent_relationship.duplicate(true))
		child["relationships"] = child_relationships
	for existing in members:
		if not existing is Dictionary or str(existing.get("family_role", "")) != "child":
			continue
		var existing_id := _person_id(existing)
		if existing_id != person_id:
			var sibling_relationship := {
				"relationship_id": _relationship_key("sibling_of", person_id, existing_id),
				"type": "sibling_of",
				"participants":
				[person_id, existing_id] if person_id < existing_id else [existing_id, person_id],
				"status": "active",
				"created_world_date": world_date.duplicate(true),
			}
			edges.append(sibling_relationship.duplicate(true))
			_store_relationship(child, sibling_relationship)
			_store_relationship(existing, sibling_relationship)
	tree["relationships"] = edges
	household["family_tree"] = tree
	household["members"] = members.duplicate(true)
	if not idempotency_key.is_empty():
		var requests: Dictionary = household.get("life_action_requests", {}).duplicate(true)
		requests[idempotency_key] = person_id
		household["life_action_requests"] = requests
	return {"ok": true, "child": child, "household": household}


static func record_retirement(person: Dictionary, world_date: Dictionary) -> Dictionary:
	if str(person.get("life_status", "alive")) == "deceased":
		return {"ok": false, "error": "character_deceased"}
	if str(person.get("life_status", "alive")) == "retired":
		for event in person.get("life_history", []):
			if (
				event is Dictionary
				and str(event.get("id", "")) == "retirement:%s" % _person_id(person)
			):
				return {
					"ok": true,
					"already_retired": true,
					"age": int(event.get("age", person.get("age", 0))),
					"life_status": "retired"
				}
		return {
			"ok": true,
			"already_retired": true,
			"age": int(person.get("age", 0)),
			"life_status": "retired"
		}
	var minimum_age := int(catalog().get("old_age", {}).get("retirement_minimum_age_years", 60))
	var age := age_on_date(person.get("date_of_birth", {}), world_date)
	if age < minimum_age:
		return {"ok": false, "error": "retirement_age_ineligible"}
	person["age"] = age
	person["life_status"] = "retired"
	person["retirement_date"] = world_date.duplicate(true)
	person["last_life_processed_date"] = world_date.duplicate(true)
	person["life_history"] = _append_history(
		person.get("life_history", []),
		{
			"id": "retirement:%s" % _person_id(person),
			"type": "retirement",
			"date": world_date.duplicate(true),
			"summary": "Retirement status was recorded for a later employment-system integration.",
			"age": age,
		}
	)
	return {"ok": true, "age": age, "life_status": "retired"}


static func record_death(
	person: Dictionary, world_date: Dictionary, cause: String, household_value: Dictionary = {}
) -> Dictionary:
	if cause not in DEATH_CAUSES:
		return {"ok": false, "error": "death_cause_invalid"}
	if str(person.get("life_status", "alive")) == "deceased":
		return {"ok": true, "already_deceased": true}
	var age := age_on_date(person.get("date_of_birth", {}), world_date)
	if (
		cause == "old_age"
		and age < int(catalog().get("old_age", {}).get("review_minimum_age_years", 80))
	):
		return {"ok": false, "error": "old_age_pathway_ineligible"}
	var person_id := _person_id(person)
	person["age"] = age
	person["age_at_death"] = age
	person["life_status"] = "deceased"
	person["death_cause"] = cause
	person["death_date"] = world_date.duplicate(true)
	person["last_life_processed_date"] = world_date.duplicate(true)
	var death_id := "death:%s" % person_id
	person["life_history"] = _append_history(
		person.get("life_history", []),
		{
			"id": death_id,
			"type": "death",
			"date": world_date.duplicate(true),
			"summary": "A life ended; the character and family records were preserved.",
			"cause_category": cause,
			"age_at_death": age,
		}
	)
	var heirs: Array[String] = []
	for relationship in person.get("relationships", []):
		if not relationship is Dictionary or str(relationship.get("status", "active")) != "active":
			continue
		var participants: Array = relationship.get("participants", [])
		var relationship_type := str(relationship.get("type", ""))
		var heir_id := ""
		if relationship_type == "spouse" and participants.size() == 2:
			heir_id = str(participants[1] if str(participants[0]) == person_id else participants[0])
		elif (
			relationship_type == "parent_of"
			and participants.size() == 2
			and str(participants[0]) == person_id
		):
			heir_id = str(participants[1])
		if not heir_id.is_empty() and not heirs.has(heir_id):
			heirs.append(heir_id)
	var inheritance_id := "inheritance:%s" % person_id
	var inheritance_event := {
		"inheritance_event_id": inheritance_id,
		"deceased_person_id": person_id,
		"world_date": world_date.duplicate(true),
		"heir_person_ids": heirs,
		"asset_reference_ids": [],
		"status": "pending_review",
		"transfer_performed": false,
	}
	var inheritance_events: Array = person.get("inheritance_events", []).duplicate(true)
	var has_inheritance_event := false
	for existing_event in inheritance_events:
		if (
			existing_event is Dictionary
			and str(existing_event.get("inheritance_event_id", "")) == inheritance_id
		):
			has_inheritance_event = true
			break
	if not has_inheritance_event:
		inheritance_events.append(inheritance_event)
	person["inheritance_events"] = inheritance_events
	for member in household_value.get("family_members", []):
		if not member is Dictionary:
			continue
		var member_id := _person_id(member)
		if member_id.is_empty() or member_id == person_id:
			continue
		member["life_history"] = _append_history(
			member.get("life_history", []),
			{
				"id": "family-death:%s:%s" % [person_id, member_id],
				"type": "family_death",
				"date": world_date.duplicate(true),
				"summary":
				"A family member's passing was recorded; their person and family records remain preserved.",
				"deceased_person_id": person_id,
			}
		)
	var inheritance_ids: Array = person.get("inheritance_event_ids", []).duplicate(true)
	if not inheritance_ids.has(inheritance_id):
		inheritance_ids.append(inheritance_id)
	person["inheritance_event_ids"] = inheritance_ids
	return {
		"ok": true,
		"already_deceased": false,
		"age_at_death": age,
		"inheritance_event_id": inheritance_id
	}


static func can_take_active_action(person: Dictionary) -> bool:
	return str(person.get("life_status", "alive")) != "deceased"


static func format_life_status(status: String) -> String:
	match status:
		"retired":
			return "Retired"
		"deceased":
			return "Deceased"
		_:
			return "Alive"


static func _new_id(prefix: String) -> String:
	return (
		"%s-%d-%d"
		% [prefix, int(Time.get_unix_time_from_system() * 1000.0), randi_range(100000, 999999)]
	)
