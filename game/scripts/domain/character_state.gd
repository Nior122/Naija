class_name CharacterState
extends RefCounted

const EducationServiceScript = preload("res://scripts/domain/education_service.gd")
const LifeSimulationServiceScript = preload("res://scripts/domain/life_simulation_service.gd")
const HouseholdFactoryScript = preload("res://scripts/domain/household_factory.gd")
const STARTING_MONEY: int = 5000
const STARTING_SCORES: Dictionary = {
	"Mathematics": 72,
	"English": 68,
	"Computer Studies": 81,
	"Biology": 64,
	"Civic Education": 75,
}

var player_id: String = ""
var character_id: String = ""
var name: String = ""
var age: int = 15
var character_type: String = "androgynous"
var appearance: Dictionary = {}
var money: int = STARTING_MONEY
var health: float = 100.0
var energy: float = 90.0
var hunger: float = 82.0
var education_level: String = "Secondary school (prototype)"
var school_id: String = "idera_secondary_school"
var home_id: String = ""
var current_location: String = "home"
var position: Vector2 = Vector2(720.0, 540.0)
var inventory: Array[Dictionary] = []
var academic_scores: Dictionary = {}
var attendance: Array[Dictionary] = []
var education_record: Dictionary = {}
var reputation: int = 0
var household: Dictionary = {}
var geographic_location: Dictionary = {}
var date_of_birth: Dictionary = {}
var life_stage_id: String = "secondary-school-youth"
var life_status: String = "alive"
var household_id: String = ""
var family_ids: Array[String] = []
var life_history: Array[Dictionary] = []
var relationships: Array[Dictionary] = []
var family_tree: Dictionary = {}
var inheritance_event_ids: Array[String] = []
var inheritance_events: Array[Dictionary] = []
var marriages: Array[Dictionary] = []
var last_life_processed_date: Dictionary = {}
var death_cause: String = ""
var death_date: Dictionary = {}
var age_at_death: int = -1
var retirement_date: Dictionary = {}
var life_profile: Dictionary = {}
var created_at: String = ""
var updated_at: String = ""


func create_new(
	character_name: String,
	starting_age: int,
	starting_character_type: String,
	starting_appearance: Dictionary,
	starting_household: Dictionary,
	starting_world_date: Dictionary = {}
) -> void:
	var now := _timestamp()
	player_id = _new_id("player")
	character_id = _new_id("character")
	name = character_name.strip_edges()
	if name.is_empty():
		name = "Ayo"
	age = 16 if starting_age == 16 else 15
	character_type = starting_character_type
	appearance = starting_appearance.duplicate(true)
	money = STARTING_MONEY
	health = 100.0
	energy = 90.0
	hunger = 82.0
	education_level = "Secondary school (prototype)"
	school_id = "idera_secondary_school"
	var world_date := (
		starting_world_date.duplicate(true)
		if LifeSimulationServiceScript.valid_date(starting_world_date)
		else LifeSimulationServiceScript.default_world_date()
	)
	household = HouseholdFactoryScript.ensure_household(starting_household, world_date)
	home_id = str(household.get("home_id", ""))
	_apply_life_data(
		LifeSimulationServiceScript.initialize_character_life(
			character_id, name, age, world_date, household
		)
	)
	_sync_family_tree()
	current_location = "home"
	position = Vector2(720.0, 540.0)
	geographic_location.clear()
	inventory.clear()
	add_item("school_bag", "School bag", 1, "school")
	add_item("notebook", "Exercise book", 1, "school")
	add_item("phone", "Basic phone", 1, "personal")
	add_item("meat_pie", "Meat pie", 1, "food", 24)
	add_item("uniform", "School uniform", 1, "clothing")
	academic_scores = STARTING_SCORES.duplicate(true)
	attendance.clear()
	education_record = EducationServiceScript.create_student_record(character_id, age, 1)
	EducationServiceScript.sync_legacy_character(self)
	reputation = 0
	created_at = now
	updated_at = now
	life_profile = _make_life_profile()


func add_item(
	item_id: String,
	item_name: String,
	quantity: int = 1,
	category: String = "misc",
	hunger_restore: int = 0
) -> void:
	if quantity <= 0 or not can_take_active_action():
		return
	for index in range(inventory.size()):
		var item := inventory[index]
		if str(item.get("id", "")) == item_id:
			item["quantity"] = int(item.get("quantity", 0)) + quantity
			inventory[index] = item
			touch()
			return
	var new_item := {
		"id": item_id,
		"name": item_name,
		"quantity": quantity,
		"category": category,
	}
	if hunger_restore > 0:
		new_item["hunger_restore"] = hunger_restore
	inventory.append(new_item)
	touch()


func consume_item(item_id: String) -> bool:
	if not can_take_active_action():
		return false
	for index in range(inventory.size()):
		var item := inventory[index]
		if str(item.get("id", "")) != item_id or int(item.get("quantity", 0)) < 1:
			continue
		var restore := int(item.get("hunger_restore", 0))
		if restore <= 0:
			return false
		item["quantity"] = int(item.get("quantity", 0)) - 1
		if int(item["quantity"]) <= 0:
			inventory.remove_at(index)
		else:
			inventory[index] = item
		hunger = clampf(hunger + float(restore), 0.0, 100.0)
		touch()
		return true
	return false


func try_spend(amount: int) -> bool:
	if not can_take_active_action() or amount < 0 or money < amount:
		return false
	money -= amount
	touch()
	return true


func advance_time(minutes: int) -> void:
	if minutes <= 0 or not can_take_active_action():
		return
	hunger = maxf(0.0, hunger - float(minutes) * 0.012)
	energy = maxf(0.0, energy - float(minutes) * 0.004)
	if hunger < 8.0 and energy < 8.0:
		health = maxf(1.0, health - float(minutes) * 0.015)


func spend_energy(amount: float) -> void:
	if not can_take_active_action():
		return
	energy = clampf(energy - maxf(amount, 0.0), 0.0, 100.0)


func sleep_until_morning() -> void:
	if not can_take_active_action():
		return
	energy = 100.0
	hunger = maxf(0.0, hunger - 18.0)
	health = minf(100.0, health + 5.0)
	touch()


func set_location(location_id: String, world_position: Vector2) -> void:
	if not can_take_active_action():
		return
	current_location = location_id
	position = world_position
	touch()


func set_geographic_location(value: Dictionary) -> void:
	if not can_take_active_action():
		return
	geographic_location = value.duplicate(true)
	touch()


func touch() -> void:
	updated_at = _timestamp()


func to_dictionary() -> Dictionary:
	return {
		"player_id": player_id,
		"character_id": character_id,
		"name": name,
		"age": age,
		"character_type": character_type,
		"appearance": appearance.duplicate(true),
		"money": money,
		"health": health,
		"energy": energy,
		"hunger": hunger,
		"education_level": education_level,
		"school_id": school_id,
		"home_id": home_id,
		"current_location": current_location,
		"position": {"x": position.x, "y": position.y},
		"inventory": inventory.duplicate(true),
		"academic_scores": academic_scores.duplicate(true),
		"attendance": attendance.duplicate(true),
		"education_record": education_record.duplicate(true),
		"reputation": reputation,
		"household": household.duplicate(true),
		"geographic_location": geographic_location.duplicate(true),
		"date_of_birth": date_of_birth.duplicate(true),
		"life_stage_id": life_stage_id,
		"life_status": life_status,
		"household_id": household_id,
		"family_ids": family_ids.duplicate(),
		"life_history": life_history.duplicate(true),
		"relationships": relationships.duplicate(true),
		"family_tree": family_tree.duplicate(true),
		"inheritance_event_ids": inheritance_event_ids.duplicate(),
		"inheritance_events": inheritance_events.duplicate(true),
		"marriages": marriages.duplicate(true),
		"last_life_processed_date": last_life_processed_date.duplicate(true),
		"death_cause": death_cause,
		"death_date": death_date.duplicate(true),
		"age_at_death": age_at_death,
		"retirement_date": retirement_date.duplicate(true),
		"life_profile": life_profile.duplicate(true),
		"created_at": created_at,
		"updated_at": updated_at,
	}


func load_dictionary(data: Dictionary, current_world_date: Dictionary = {}) -> void:
	player_id = str(data.get("player_id", _new_id("player")))
	character_id = str(data.get("character_id", _new_id("character")))
	name = str(data.get("name", "Ayo")).strip_edges()
	if name.is_empty():
		name = "Ayo"
	age = clampi(int(data.get("age", 15)), 0, 9998)
	character_type = str(data.get("character_type", "androgynous"))
	var raw_appearance: Variant = data.get("appearance", {})
	appearance = raw_appearance.duplicate(true) if raw_appearance is Dictionary else {}
	money = maxi(0, int(data.get("money", STARTING_MONEY)))
	health = clampf(float(data.get("health", 100.0)), 0.0, 100.0)
	energy = clampf(float(data.get("energy", 90.0)), 0.0, 100.0)
	hunger = clampf(float(data.get("hunger", 82.0)), 0.0, 100.0)
	education_level = str(data.get("education_level", "Secondary school (prototype)"))
	school_id = str(data.get("school_id", "idera_secondary_school"))
	home_id = str(data.get("home_id", ""))
	current_location = str(data.get("current_location", "home"))
	var raw_position: Variant = data.get("position", {})
	if raw_position is Dictionary:
		position = Vector2(float(raw_position.get("x", 720.0)), float(raw_position.get("y", 540.0)))
	else:
		position = Vector2(720.0, 540.0)
	inventory.clear()
	var raw_inventory: Variant = data.get("inventory", [])
	if raw_inventory is Array:
		for entry in raw_inventory:
			if entry is Dictionary:
				inventory.append(entry.duplicate(true))
	var raw_scores: Variant = data.get("academic_scores", {})
	academic_scores = (
		raw_scores.duplicate(true) if raw_scores is Dictionary else STARTING_SCORES.duplicate(true)
	)
	attendance.clear()
	var raw_attendance: Variant = data.get("attendance", [])
	if raw_attendance is Array:
		for record in raw_attendance:
			if record is Dictionary:
				attendance.append(record.duplicate(true))
	var raw_education: Variant = data.get("education_record", {})
	if (
		raw_education is Dictionary
		and EducationServiceScript._record_shape_is_valid(raw_education)
		and str(raw_education.get("character_id", "")) == character_id
		and str(raw_education.get("student_id", "")) == "student-" + character_id
	):
		education_record = raw_education.duplicate(true)
	else:
		education_record = EducationServiceScript.migrate_legacy_record(
			character_id, age, school_id, academic_scores, attendance, 1
		)
	reputation = int(data.get("reputation", 0))
	var raw_household: Variant = data.get("household", {})
	household = raw_household.duplicate(true) if raw_household is Dictionary else {}
	var raw_geographic_location: Variant = data.get("geographic_location", {})
	geographic_location = (
		raw_geographic_location.duplicate(true) if raw_geographic_location is Dictionary else {}
	)
	var raw_life_profile: Variant = data.get("life_profile", {})
	life_profile = raw_life_profile.duplicate(true) if raw_life_profile is Dictionary else {}
	var raw_dob: Variant = data.get("date_of_birth", {})
	date_of_birth = raw_dob.duplicate(true) if raw_dob is Dictionary else {}
	life_stage_id = str(data.get("life_stage_id", "secondary-school-youth"))
	life_status = str(data.get("life_status", "alive"))
	if life_status not in ["alive", "retired", "deceased"]:
		life_status = "alive"
	household_id = str(data.get("household_id", household.get("id", "")))
	family_ids.clear()
	var raw_family_ids: Variant = data.get(
		"family_ids", household.get("family_ids", life_profile.get("family_ids", []))
	)
	if raw_family_ids is Array:
		for family_id in raw_family_ids:
			if typeof(family_id) == TYPE_STRING:
				family_ids.append(str(family_id))
	_load_life_history(data.get("life_history", life_profile.get("history", [])), life_history)
	_load_dictionary_array(
		data.get("relationships", life_profile.get("relationships", [])), relationships
	)
	var raw_family_tree: Variant = data.get("family_tree", {})
	if not raw_family_tree is Dictionary or raw_family_tree.is_empty():
		raw_family_tree = _family_tree_from_profile(
			life_profile.get("family_tree", {}), life_profile.get("family_ids", [])
		)
	family_tree = raw_family_tree.duplicate(true) if raw_family_tree is Dictionary else {}
	_household_from_life_profile()
	inheritance_event_ids.clear()
	var raw_inheritance_ids: Variant = data.get("inheritance_event_ids", [])
	if raw_inheritance_ids is Array:
		for event_id in raw_inheritance_ids:
			if typeof(event_id) == TYPE_STRING:
				inheritance_event_ids.append(str(event_id))
	_load_dictionary_array(data.get("inheritance_events", []), inheritance_events)
	_load_dictionary_array(data.get("marriages", []), marriages)
	var raw_last_life_date: Variant = data.get("last_life_processed_date", {})
	last_life_processed_date = (
		raw_last_life_date.duplicate(true) if raw_last_life_date is Dictionary else {}
	)
	death_cause = str(data.get("death_cause", ""))
	var raw_death_date: Variant = data.get("death_date", {})
	death_date = raw_death_date.duplicate(true) if raw_death_date is Dictionary else {}
	age_at_death = int(data.get("age_at_death", -1))
	var raw_retirement_date: Variant = data.get("retirement_date", {})
	retirement_date = (
		raw_retirement_date.duplicate(true) if raw_retirement_date is Dictionary else {}
	)
	created_at = str(data.get("created_at", _timestamp()))
	updated_at = str(data.get("updated_at", _timestamp()))
	var processing_date := (
		current_world_date.duplicate(true)
		if LifeSimulationServiceScript.valid_date(current_world_date)
		else LifeSimulationServiceScript.default_world_date()
	)
	advance_life_to_date(processing_date)
	EducationServiceScript.sync_legacy_character(self)


func ensure_life_data(world_date: Dictionary) -> void:
	var processing_date := (
		world_date.duplicate(true)
		if LifeSimulationServiceScript.valid_date(world_date)
		else LifeSimulationServiceScript.default_world_date()
	)
	household = HouseholdFactoryScript.ensure_household(household, processing_date)
	household_id = str(household.get("id", household_id))
	home_id = str(household.get("home_id", home_id))
	if not LifeSimulationServiceScript.valid_date(date_of_birth):
		var initial_age := clampi(age, 0, 9998)
		var migrated := LifeSimulationServiceScript.initialize_character_life(
			character_id, name, initial_age, processing_date, household
		)
		_apply_life_data(migrated)
	else:
		_apply_life_data(
			LifeSimulationServiceScript.process_person_to_date(_life_record(), processing_date)
		)
	household = LifeSimulationServiceScript.process_household_to_date(household, processing_date)
	_sync_family_tree()
	EducationServiceScript.sync_legacy_character(self)
	life_profile = _make_life_profile()


func advance_life_to_date(world_date: Dictionary) -> void:
	ensure_life_data(world_date)


func get_life_profile() -> Dictionary:
	if life_profile.is_empty():
		life_profile = _make_life_profile()
	return life_profile.duplicate(true)


func can_take_active_action() -> bool:
	return LifeSimulationServiceScript.can_take_active_action(_life_record())


func record_retirement(world_date: Dictionary) -> Dictionary:
	var person := _life_record()
	var result := LifeSimulationServiceScript.record_retirement(person, world_date)
	if bool(result.get("ok", false)):
		_apply_life_data(person)
		life_profile = _make_life_profile()
		touch()
	return result


func record_death(world_date: Dictionary, cause_category: String) -> Dictionary:
	var person := _life_record()
	var result := LifeSimulationServiceScript.record_death(
		person, world_date, cause_category, household
	)
	if bool(result.get("ok", false)):
		_apply_life_data(person)
		_sync_family_tree()
		life_profile = _make_life_profile()
		touch()
	return result


func propose_relationship(
	partner_value: Dictionary, stage: String, world_date: Dictionary
) -> Dictionary:
	var person := _life_record()
	var partner := partner_value.duplicate(true)
	var result := LifeSimulationServiceScript.propose_relationship(
		person, partner, stage, world_date, household
	)
	if not bool(result.get("ok", false)):
		return result
	var person_result: Variant = result.get("person", person)
	if person_result is Dictionary:
		_apply_life_data(person_result)
	var partner_result: Variant = result.get("partner", partner)
	if partner_result is Dictionary:
		result["partner"] = partner_result.duplicate(true)
	var marriage_value: Variant = result.get("marriage", {})
	if marriage_value is Dictionary and not marriage_value.is_empty():
		var new_household: Variant = result.get("household", {})
		if new_household is Dictionary and not new_household.is_empty():
			household = new_household.duplicate(true)
		household_id = str(household.get("id", household_id))
		home_id = str(household.get("home_id", home_id))
		family_ids.clear()
		for family_id_value in household.get("family_ids", []):
			family_ids.append(str(family_id_value))
	_sync_family_tree()
	life_profile = _make_life_profile()
	result["person"] = _life_record()
	result["household"] = household.duplicate(true)
	touch()
	return result


func record_marriage(partner_value: Dictionary, world_date: Dictionary) -> Dictionary:
	var person := _life_record()
	var partner := partner_value.duplicate(true)
	var result := LifeSimulationServiceScript.record_marriage(
		person, partner, world_date, household
	)
	if not bool(result.get("ok", false)):
		return result
	household = result.get("household", household).duplicate(true)
	household_id = str(household.get("id", household_id))
	home_id = str(household.get("home_id", home_id))
	family_ids.clear()
	for family_id_value in household.get("family_ids", []):
		family_ids.append(str(family_id_value))
	var members: Array = household.get("family_members", []).duplicate(true)
	var partner_id := str(partner.get("character_id", partner.get("person_id", "")))
	var found_partner := false
	for member in members:
		if (
			member is Dictionary
			and str(member.get("person_id", member.get("character_id", ""))) == partner_id
		):
			found_partner = true
			break
	if not found_partner and not partner_id.is_empty():
		partner["person_id"] = partner_id
		partner["family_role"] = "spouse"
		members.append(partner.duplicate(true))
	household["family_members"] = members
	person["household_id"] = household.get("id", "")
	person["family_ids"] = household.get("family_ids", [])
	_apply_life_data(person)
	_sync_family_tree()
	life_profile = _make_life_profile()
	result["partner"] = partner
	result["person"] = _life_record()
	result["household"] = household.duplicate(true)
	touch()
	return result


func record_childbirth(
	partner_value: Dictionary,
	child_name: String,
	world_date: Dictionary,
	idempotency_key: String = ""
) -> Dictionary:
	var person := _life_record()
	var partner := partner_value.duplicate(true)
	var result := LifeSimulationServiceScript.record_childbirth(
		person, partner, household, child_name, world_date, idempotency_key
	)
	if not bool(result.get("ok", false)):
		return result
	_apply_life_data(person)
	household = result.get("household", household).duplicate(true)
	household_id = str(household.get("id", household_id))
	home_id = str(household.get("home_id", home_id))
	family_ids.clear()
	for family_id_value in household.get("family_ids", []):
		family_ids.append(str(family_id_value))
	_sync_family_tree()
	life_profile = _make_life_profile()
	result["person"] = _life_record()
	result["partner"] = partner
	result["household"] = household.duplicate(true)
	life_profile = _make_life_profile()
	touch()
	return result


func _life_record() -> Dictionary:
	return {
		"character_id": character_id,
		"person_id": character_id,
		"name": name,
		"age": age,
		"date_of_birth": date_of_birth.duplicate(true),
		"life_stage_id": life_stage_id,
		"life_status": life_status,
		"household_id": household_id,
		"family_ids": family_ids.duplicate(),
		"life_history": life_history.duplicate(true),
		"relationships": relationships.duplicate(true),
		"family_tree": family_tree.duplicate(true),
		"inheritance_event_ids": inheritance_event_ids.duplicate(),
		"inheritance_events": inheritance_events.duplicate(true),
		"marriages": marriages.duplicate(true),
		"last_life_processed_date": last_life_processed_date.duplicate(true),
		"death_cause": death_cause,
		"death_date": death_date.duplicate(true),
		"age_at_death": age_at_death,
		"retirement_date": retirement_date.duplicate(true),
		"education_level": education_level,
		"home_id": home_id,
		"life_profile": life_profile.duplicate(true),
	}


func _apply_life_data(data: Dictionary) -> void:
	var raw_dob: Variant = data.get("date_of_birth", {})
	date_of_birth = raw_dob.duplicate(true) if raw_dob is Dictionary else {}
	age = clampi(int(data.get("age", age)), 0, 9998)
	life_stage_id = str(
		data.get(
			"life_stage_id",
			LifeSimulationServiceScript.life_stage_for_age(age).get("id", "unknown")
		)
	)
	life_status = str(data.get("life_status", "alive"))
	if life_status not in ["alive", "retired", "deceased"]:
		life_status = "alive"
	household_id = str(data.get("household_id", household_id))
	family_ids.clear()
	var raw_family_ids: Variant = data.get("family_ids", [])
	if raw_family_ids is Array:
		for family_id_value in raw_family_ids:
			family_ids.append(str(family_id_value))
	_load_dictionary_array(data.get("life_history", []), life_history)
	_load_dictionary_array(data.get("relationships", []), relationships)
	var raw_tree: Variant = data.get("family_tree", {})
	family_tree = raw_tree.duplicate(true) if raw_tree is Dictionary else {}
	inheritance_event_ids.clear()
	var raw_inheritance_ids: Variant = data.get("inheritance_event_ids", [])
	if raw_inheritance_ids is Array:
		for event_id in raw_inheritance_ids:
			inheritance_event_ids.append(str(event_id))
	_load_dictionary_array(data.get("inheritance_events", []), inheritance_events)
	_load_dictionary_array(data.get("marriages", []), marriages)
	var raw_last_date: Variant = data.get("last_life_processed_date", {})
	last_life_processed_date = raw_last_date.duplicate(true) if raw_last_date is Dictionary else {}
	death_cause = str(data.get("death_cause", ""))
	var raw_death: Variant = data.get("death_date", {})
	death_date = raw_death.duplicate(true) if raw_death is Dictionary else {}
	age_at_death = int(data.get("age_at_death", -1))
	var raw_retirement: Variant = data.get("retirement_date", {})
	retirement_date = raw_retirement.duplicate(true) if raw_retirement is Dictionary else {}
	var raw_profile: Variant = data.get("life_profile", {})
	life_profile = raw_profile.duplicate(true) if raw_profile is Dictionary else {}


func _load_dictionary_array(value: Variant, target: Array[Dictionary]) -> void:
	target.clear()
	if value is Array:
		for entry in value:
			if entry is Dictionary:
				target.append(entry.duplicate(true))


func _load_life_history(value: Variant, target: Array[Dictionary]) -> void:
	target.clear()
	if not value is Array:
		return
	for entry in value:
		if not entry is Dictionary:
			continue
		var event: Dictionary = entry.duplicate(true)
		event["id"] = str(event.get("id", event.get("event_id", "life-event-unknown")))
		event["type"] = str(event.get("type", event.get("event_type", "life_event")))
		var event_date: Variant = event.get("date", event.get("world_date", {}))
		event["date"] = event_date.duplicate(true) if event_date is Dictionary else {}
		event["summary"] = str(event.get("summary", event.get("type", "Life event")))
		if not event.has("age") and event.get("data", {}) is Dictionary and event.data.has("age"):
			event["age"] = int(event.data.age)
		target.append(event)


func _family_tree_from_profile(value: Variant, profile_family_ids: Variant = []) -> Dictionary:
	if not value is Dictionary:
		return {}
	var tree_people: Variant = value.get("members", value.get("people", []))
	var tree_relationships: Variant = value.get("relationships", [])
	var family_id := str(value.get("family_id", ""))
	if family_id.is_empty() and profile_family_ids is Array and not profile_family_ids.is_empty():
		family_id = str(profile_family_ids[0])
	var ids: Array[String] = []
	if tree_people is Array:
		for person in tree_people:
			if not person is Dictionary:
				continue
			var person_id := str(
				person.get("person_id", person.get("character_id", person.get("id", "")))
			)
			if not person_id.is_empty() and not ids.has(person_id):
				ids.append(person_id)
	return {
		"family_id": family_id,
		"family_name": str(value.get("family_name", "Family")),
		"member_ids": ids,
		"members": tree_people.duplicate(true) if tree_people is Array else [],
		"relationships": tree_relationships.duplicate(true) if tree_relationships is Array else [],
		"parent_family_ids":
		(
			value.get("parent_family_ids", []).duplicate(true)
			if value.get("parent_family_ids", []) is Array
			else []
		),
	}


func _household_from_life_profile() -> void:
	if life_profile.is_empty():
		return
	var profile_members: Variant = life_profile.get("family_members", [])
	if not profile_members is Array or profile_members.is_empty():
		var raw_tree: Variant = life_profile.get("family_tree", {})
		if raw_tree is Dictionary:
			profile_members = raw_tree.get("people", raw_tree.get("members", []))
	var existing_members: Variant = household.get("family_members", [])
	if (not existing_members is Array or existing_members.is_empty()) and profile_members is Array:
		var normalized_members: Array[Dictionary] = []
		for entry in profile_members:
			if not entry is Dictionary:
				continue
			var member: Dictionary = entry.duplicate(true)
			var member_id := str(
				member.get("person_id", member.get("character_id", member.get("id", "")))
			)
			if member_id.is_empty() or member_id == character_id:
				continue
			member["person_id"] = member_id
			member["family_role"] = str(member.get("family_role", member.get("role", "relative")))
			member["household_id"] = str(member.get("household_id", household_id))
			member["home_id"] = str(member.get("home_id", home_id))
			member["family_ids"] = (
				member.get("family_ids", family_ids).duplicate(true)
				if member.get("family_ids", family_ids) is Array
				else family_ids.duplicate()
			)
			member["is_player_controlled"] = false
			normalized_members.append(member)
		household["family_members"] = normalized_members
		var guardians: Array[Dictionary] = []
		var siblings: Array[Dictionary] = []
		for member in normalized_members:
			if str(member.get("family_role", "")) in ["parent", "guardian"]:
				guardians.append(member.duplicate(true))
			elif str(member.get("family_role", "")) == "sibling":
				siblings.append(member.duplicate(true))
		household["guardians"] = guardians
		household["siblings"] = siblings
	var family_tree_value: Variant = life_profile.get("family_tree", {})
	if family_tree_value is Dictionary and not family_tree_value.is_empty():
		household["family_tree"] = _family_tree_from_profile(family_tree_value, family_ids)
	if household_id.is_empty():
		household_id = str(life_profile.get("household_id", household.get("id", "")))
	if household_id.is_empty():
		household_id = str(household.get("id", ""))
	if household_id.is_empty():
		household_id = "household-" + character_id
	household["id"] = household_id
	if not home_id.is_empty():
		household["home_id"] = home_id
	if family_ids.is_empty():
		var profile_ids: Variant = life_profile.get("family_ids", [])
		if profile_ids is Array:
			for profile_id in profile_ids:
				family_ids.append(str(profile_id))
	if not family_ids.is_empty():
		household["family_id"] = family_ids[0]
		household["family_ids"] = family_ids.duplicate()


func _sync_family_tree() -> void:
	var family_id := str(household.get("family_id", ""))
	if family_id.is_empty() and not family_ids.is_empty():
		family_id = family_ids[0]
	if family_id.is_empty():
		family_id = "family-" + character_id
	if not family_ids.has(family_id):
		family_ids.append(family_id)
	var members: Array = household.get("family_members", []).duplicate(true)
	var tree_members: Array[Dictionary] = [
		{
			"person_id": character_id,
			"character_id": character_id,
			"name": name,
			"age": age,
			"date_of_birth": date_of_birth.duplicate(true),
			"life_stage_id": life_stage_id,
			"life_status": life_status,
			"family_role": "player_character",
			"is_player_controlled": true,
		}
	]
	var member_ids: Array[String] = [character_id]
	var guardian_ids: Array[String] = []
	var child_ids: Array[String] = [character_id]
	var sibling_ids: Array[String] = [character_id]
	var own_child_ids: Array[String] = []
	for relative in members:
		if not relative is Dictionary:
			continue
		var relative_id := str(relative.get("person_id", relative.get("character_id", "")))
		if relative_id.is_empty() or relative_id == character_id:
			continue
		var relative_copy: Dictionary = relative.duplicate(true)
		relative_copy["person_id"] = relative_id
		tree_members.append(relative_copy)
		if not member_ids.has(relative_id):
			member_ids.append(relative_id)
		var role := str(relative.get("family_role", ""))
		if role in ["parent", "guardian"]:
			guardian_ids.append(relative_id)
		elif role == "sibling":
			child_ids.append(relative_id)
			sibling_ids.append(relative_id)
		elif role == "child":
			own_child_ids.append(relative_id)
	var existing_tree: Variant = household.get("family_tree", {})
	if existing_tree is Dictionary:
		var existing_members: Variant = existing_tree.get(
			"members", existing_tree.get("people", [])
		)
		if existing_members is Array:
			for tree_member in existing_members:
				if not tree_member is Dictionary:
					continue
				var tree_member_id := str(
					tree_member.get(
						"person_id", tree_member.get("character_id", tree_member.get("id", ""))
					)
				)
				if tree_member_id.is_empty() or member_ids.has(tree_member_id):
					continue
				var tree_member_copy: Dictionary = tree_member.duplicate(true)
				tree_member_copy["person_id"] = tree_member_id
				tree_members.append(tree_member_copy)
				member_ids.append(tree_member_id)
	var edges: Array[Dictionary] = []
	var seen_edges: Dictionary = {}
	for relationship in relationships:
		_add_tree_edge(edges, seen_edges, relationship)
	if existing_tree is Dictionary:
		for relationship in existing_tree.get("relationships", []):
			if relationship is Dictionary:
				_add_tree_edge(edges, seen_edges, relationship)
	for guardian_id in guardian_ids:
		var guardian := _find_family_person(guardian_id)
		var edge_type := (
			"parent_of" if str(guardian.get("family_role", "")) == "parent" else "guardian_of"
		)
		_add_tree_edge(
			edges,
			seen_edges,
			{
				"relationship_id": "%s:%s:%s" % [edge_type, guardian_id, character_id],
				"type": edge_type,
				"participants": [guardian_id, character_id],
				"status": "active",
			}
		)
		for child_id in child_ids:
			if child_id != character_id:
				_add_tree_edge(
					edges,
					seen_edges,
					{
						"relationship_id": "%s:%s:%s" % [edge_type, guardian_id, child_id],
						"type": edge_type,
						"participants": [guardian_id, child_id],
						"status": "active",
					}
				)
	for child_id in own_child_ids:
		_add_tree_edge(
			edges,
			seen_edges,
			{
				"relationship_id": "parent_of:%s:%s" % [character_id, child_id],
				"type": "parent_of",
				"participants": [character_id, child_id],
				"status": "active",
			}
		)
	for left_index in range(sibling_ids.size()):
		for right_index in range(left_index + 1, sibling_ids.size()):
			var left_id := sibling_ids[left_index]
			var right_id := sibling_ids[right_index]
			_add_tree_edge(
				edges,
				seen_edges,
				{
					"relationship_id": "sibling_of:%s:%s" % [left_id, right_id],
					"type": "sibling_of",
					"participants": [left_id, right_id],
					"status": "active",
				}
			)
	var tree := {
		"family_id": family_id,
		"family_name": str(household.get("family_name", "Family")),
		"member_ids": member_ids,
		"members": tree_members,
		"relationships": edges,
		"parent_family_ids": household.get("parent_family_ids", []),
	}
	family_tree = tree.duplicate(true)
	household["family_id"] = family_id
	household["family_ids"] = family_ids.duplicate()
	household["member_ids"] = member_ids
	household["members"] = tree_members.duplicate(true)
	household["family_tree"] = tree.duplicate(true)
	life_profile = _make_life_profile()


func _add_tree_edge(edges: Array[Dictionary], seen: Dictionary, relationship: Dictionary) -> void:
	var participants: Variant = relationship.get("participants", [])
	var edge_type := str(relationship.get("type", "relationship"))
	var edge_id := str(
		relationship.get("relationship_id", "%s:%s" % [edge_type, str(participants)])
	)
	if seen.has(edge_id):
		return
	seen[edge_id] = true
	edges.append(relationship.duplicate(true))


func _find_family_person(person_id: String) -> Dictionary:
	for person in household.get("family_members", []):
		if (
			person is Dictionary
			and str(person.get("person_id", person.get("character_id", ""))) == person_id
		):
			return person
	return {}


func _make_life_profile() -> Dictionary:
	var stage := LifeSimulationServiceScript.life_stage_for_age(age)
	return {
		"age": age,
		"date_of_birth": date_of_birth.duplicate(true),
		"life_stage_id": life_stage_id,
		"life_stage_label": str(stage.get("label", life_stage_id)),
		"life_status": life_status,
		"life_status_label": LifeSimulationServiceScript.format_life_status(life_status),
		"household_id": household_id,
		"family_ids": family_ids.duplicate(),
		"family_tree": family_tree.duplicate(true),
		"family": family_tree.get("members", []).duplicate(true),
		"relationships": relationships.duplicate(true),
		"life_history": life_history.duplicate(true),
		"history": life_history.duplicate(true),
		"education_level": education_level,
		"education_record": education_record.duplicate(true),
		"death_cause": death_cause,
		"death_date": death_date.duplicate(true),
		"age_at_death": age_at_death,
		"retirement_date": retirement_date.duplicate(true),
		"inheritance_events": inheritance_events.duplicate(true),
	}


static func _new_id(prefix: String) -> String:
	return (
		"%s-%d-%d"
		% [prefix, int(Time.get_unix_time_from_system() * 1000.0), randi_range(100000, 999999)]
	)


static func _timestamp() -> String:
	return Time.get_datetime_string_from_system(true)
