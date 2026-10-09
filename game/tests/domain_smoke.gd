extends SceneTree

const CharacterStateScript = preload("res://scripts/domain/character_state.gd")
const WorldClockScript = preload("res://scripts/domain/world_clock.gd")
const HouseholdFactoryScript = preload("res://scripts/domain/household_factory.gd")
const LifeSimulationServiceScript = preload("res://scripts/domain/life_simulation_service.gd")
const SchoolServiceScript = preload("res://scripts/domain/school_service.gd")
const SaveServiceScript = preload("res://scripts/services/save_service.gd")
const WorldMapScript = preload("res://scripts/world/world_map.gd")
const TEST_SAVE_PATH: String = "user://naija-stage1-test-save.json"

var _failures: Array[String] = []
var _checks: int = 0


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	_test_character_creation_and_household()
	_test_needs_money_and_inventory()
	_test_school_records()
	_test_world_interactions()
	_test_clock()
	_test_life_simulation()
	_test_save_and_load()
	if _failures.is_empty():
		print("PASS: %d Stage 1–5 domain checks" % _checks)
		quit(0)
	else:
		for failure in _failures:
			push_error(failure)
		print("FAIL: %d of %d Stage 1 domain checks" % [_failures.size(), _checks])
		quit(1)


func _test_character_creation_and_household() -> void:
	var family_one: Dictionary = HouseholdFactoryScript.create_household()
	var family_two: Dictionary = HouseholdFactoryScript.create_household()
	var character := CharacterStateScript.new()
	character.create_new("  Seyi  ", 24, "girl", {"hairstyle": "Braids"}, family_one)
	_check(character.name == "Seyi", "Character names are trimmed")
	_check(character.age == 15, "An invalid adult starting age is constrained to the student range")
	_check(
		not character.player_id.is_empty() and not character.character_id.is_empty(),
		"Player and character IDs are created"
	)
	_check(
		character.home_id == str(family_one.get("home_id", "")),
		"Character is linked to a generated family home"
	)
	_check(
		not str(family_one.get("id", "")) == str(family_two.get("id", "")),
		"New characters receive different households"
	)
	_check(character.inventory.size() >= 4, "A new student receives a small starter inventory")
	var sixteen_year_old := CharacterStateScript.new()
	sixteen_year_old.create_new("Mina", 16, "androgynous", {}, family_two)
	_check(sixteen_year_old.age == 16, "Age 16 is a valid student starting age")


func _test_needs_money_and_inventory() -> void:
	var character := CharacterStateScript.new()
	character.create_new("Ayo", 15, "androgynous", {}, HouseholdFactoryScript.create_household())
	var starting_money := character.money
	_check(
		not character.try_spend(starting_money + 1), "The wallet prevents an unaffordable purchase"
	)
	_check(character.money == starting_money, "A failed purchase does not change the balance")
	_check(character.try_spend(350), "A valid Naira purchase succeeds")
	_check(character.money == starting_money - 350, "The Naira balance is updated")
	var hunger_before := character.hunger
	_check(character.consume_item("meat_pie"), "Food in the bag can be consumed")
	_check(character.hunger > hunger_before, "Eating improves hunger")
	_check(
		not character.consume_item("meat_pie"), "A consumed one-off item is removed from inventory"
	)
	var hunger_before_time := character.hunger
	var energy_before := character.energy
	character.advance_time(60)
	_check(character.hunger < hunger_before_time, "Hunger decreases as game time passes")
	_check(character.energy < energy_before, "Energy decreases as game time passes")
	character.health = 10.0
	character.hunger = 1.0
	character.energy = 1.0
	character.advance_time(60)
	_check(character.health < 10.0, "Very low hunger and energy gradually affect health")
	character.energy = 23.0
	character.sleep_until_morning()
	_check(is_equal_approx(character.energy, 100.0), "Sleeping restores energy")


func _test_school_records() -> void:
	var character := CharacterStateScript.new()
	character.create_new("Ayo", 15, "androgynous", {}, HouseholdFactoryScript.create_household())
	var clock := WorldClockScript.new()
	var first_lesson: Dictionary = SchoolServiceScript.next_lesson(
		character, clock.day, clock.minute_of_day
	)
	_check(
		str(first_lesson.get("subject", "")) == "Mathematics",
		"The morning timetable starts with Mathematics"
	)
	var prior_score := int(character.academic_scores["Mathematics"])
	var new_score: int = SchoolServiceScript.record_result(
		character, clock.day, "Mathematics", true, "08:00"
	)
	_check(new_score > prior_score, "A correct class activity improves the academic average")
	_check(character.attendance.size() == 1, "Attending class stores an attendance record")
	var following_lesson: Dictionary = SchoolServiceScript.next_lesson(
		character, clock.day, clock.minute_of_day
	)
	_check(
		str(following_lesson.get("subject", "")) == "English",
		"A completed subject is not repeated in the same day"
	)
	var english_score_before := int(character.academic_scores["English"])
	var english_score_after: int = SchoolServiceScript.record_result(
		character, clock.day, "English", false, "09:00"
	)
	_check(english_score_after < english_score_before, "An incorrect activity affects performance")
	_check(character.attendance.size() == 2, "Multiple class activities create distinct records")


func _test_world_interactions() -> void:
	var family: Dictionary = HouseholdFactoryScript.create_household()
	var world := WorldMapScript.new()
	root.add_child(world)
	world.enter_location("home", family)
	var bed := world.nearest_interactable(Vector2(440.0, 350.0))
	_check(
		is_instance_valid(bed) and bed.action_id == "sleep", "Nearby home objects can be targeted"
	)
	world.enter_location("schoolyard", family)
	var teacher := world.nearest_interactable(Vector2(770.0, 530.0))
	_check(
		is_instance_valid(teacher) and teacher.action_id == "talk",
		"Nearby NPCs share the reusable interaction target system"
	)
	world.queue_free()


func _test_clock() -> void:
	var clock := WorldClockScript.new()
	_check(clock.time_label() == "07:50", "A new life starts in the morning")
	clock.advance_minutes(10)
	_check(clock.time_label() == "08:00", "The game clock advances by minutes")
	_check(clock.daypart() == "Morning", "The clock reports morning")
	clock.advance_minutes(16 * 60)
	_check(clock.day == 2 and clock.time_label() == "00:00", "The clock rolls over to the next day")
	_check(clock.daypart() == "Night", "The clock reports night")


func _test_life_simulation() -> void:
	var clock := WorldClockScript.new()
	var date := clock.calendar_date()
	_check(
		date == {"year": 2025, "month": 1, "day": 1},
		"The shared calendar starts on its configured world date"
	)
	var seconds_clock := WorldClockScript.new()
	seconds_clock.advance_milliseconds(1950)
	_check(
		seconds_clock.time_label_with_seconds().ends_with(":01"),
		"Clock persistence includes seconds within a game minute"
	)
	_check(
		seconds_clock.week_number() == 1 and seconds_clock.weekday_name() == "Wednesday",
		"Calendar exposes its week and weekday"
	)
	_check(
		LifeSimulationServiceScript.world_week(6) == 2,
		"Calendar weeks begin on the configured Monday"
	)

	var household: Dictionary = HouseholdFactoryScript.create_household(date)
	var relatives: Array = household.get("family_members", [])
	_check(
		relatives.size() >= 2 and relatives.size() <= 4,
		"Starter household follows a configurable caregiver and sibling profile"
	)
	var person_ids: Array[String] = []
	var unique_person_ids: Dictionary = {}
	var caregiver_count := 0
	var sibling_count := 0
	for relative in relatives:
		var person_id := str(relative.get("person_id", ""))
		person_ids.append(person_id)
		unique_person_ids[person_id] = true
		if str(relative.get("family_role", "")) in ["parent", "guardian"]:
			caregiver_count += 1
		elif str(relative.get("family_role", "")) == "sibling":
			sibling_count += 1
		_check(
			not bool(relative.get("is_player_controlled", true)),
			"Family NPCs are persistent non-player people"
		)
	_check(
		caregiver_count >= 1 and sibling_count >= 1,
		"Starter families include a configured caregiver and one or more siblings"
	)
	_check(
		person_ids.size() == unique_person_ids.size(),
		"Starter NPCs receive distinct stable person IDs"
	)

	var character := CharacterStateScript.new()
	character.create_new("Life Test", 15, "androgynous", {}, household, date)
	_check(
		LifeSimulationServiceScript.valid_date(character.date_of_birth),
		"Character creation stores a valid DOB"
	)
	_check(
		LifeSimulationServiceScript.age_on_date(character.date_of_birth, date) == 15,
		"Age derives from DOB and the world date"
	)
	_check(
		character.family_tree.get("members", []).size() == relatives.size() + 1,
		"Family tree is generic and includes the player plus configured NPC relatives"
	)
	_check(
		not character.life_history.is_empty(),
		"Character and family creation are recorded in persistent history"
	)

	character.date_of_birth = {"year": 2010, "month": 1, "day": 1}
	character.age = 15
	character.last_life_processed_date = date.duplicate(true)
	character.life_history.clear()
	var future_date := {"year": 2028, "month": 1, "day": 1}
	character.advance_life_to_date(future_date)
	var birthday_count := 0
	for event in character.life_history:
		if str(event.get("type", "")) == "birthday":
			birthday_count += 1
	_check(
		character.age == 18 and character.life_stage_id == "young-adult",
		"Offline aging catches up DOB-derived ages and configured stages"
	)
	_check(birthday_count == 3, "Offline catch-up records each missed birthday")
	character.advance_life_to_date(future_date)
	var repeated_birthday_count := 0
	for event in character.life_history:
		if str(event.get("type", "")) == "birthday":
			repeated_birthday_count += 1
	_check(repeated_birthday_count == birthday_count, "Repeated lifecycle catch-up is idempotent")

	var minor := _life_test_person("minor-1", 15, date)
	var adult_one := _life_test_person("adult-1", 18, date)
	var adult_two := _life_test_person("adult-2", 20, date)
	_check(
		(
			LifeSimulationServiceScript.can_form_relationship(minor, adult_one, "meet", date)
			== "relationship_age_restricted"
		),
		"Romantic progression rejects a minor"
	)
	_check(
		(
			LifeSimulationServiceScript
			. can_form_relationship(minor, adult_one, "friendship", date)
			. is_empty()
		),
		"Age-appropriate minor friendship remains available"
	)
	_check(
		(
			LifeSimulationServiceScript
			. can_form_relationship(adult_one, adult_two, "meet", date)
			. is_empty()
		),
		"Adult-stage relationship progression is available"
	)
	var family_sibling: Dictionary = {}
	for relative in relatives:
		if str(relative.get("family_role", "")) == "sibling":
			family_sibling = relative.duplicate(true)
			break
	var family_adult: Dictionary = character._life_record()
	family_adult["date_of_birth"] = LifeSimulationServiceScript.date_of_birth_for_age(
		date, 25, "close-family-player"
	)
	family_adult["age"] = 25
	family_adult["life_stage_id"] = "young-adult"
	family_sibling["date_of_birth"] = LifeSimulationServiceScript.date_of_birth_for_age(
		date, 25, "close-family-sibling"
	)
	family_sibling["age"] = 25
	family_sibling["life_stage_id"] = "young-adult"
	var restricted_marriage := LifeSimulationServiceScript.record_marriage(
		family_adult, family_sibling, date, character.household
	)
	_check(
		str(restricted_marriage.get("error", "")) == "relationship_close_family_restricted",
		"Direct marriage recording rejects a close family member"
	)
	var progression: Array = (
		LifeSimulationServiceScript
		. catalog()
		. get("relationship_rules", {})
		. get("romantic_progression", [])
	)
	var marriage_result: Dictionary = {}
	for stage_value in progression:
		var stage := str(stage_value)
		var proposal := LifeSimulationServiceScript.propose_relationship(
			adult_one, adult_two, stage, date
		)
		_check(
			bool(proposal.get("ok", false)) and str(proposal.get("status", "")) == "pending",
			"Adult relationship stage requires mutual confirmation: " + stage
		)
		var confirmation := LifeSimulationServiceScript.propose_relationship(
			adult_two, adult_one, stage, date
		)
		_check(
			(
				bool(confirmation.get("ok", false))
				and str(confirmation.get("status", "")) == "confirmed"
			),
			"Mutually confirmed relationship stage is recorded: " + stage
		)
		if stage == "marriage":
			marriage_result = confirmation
	_check(
		not marriage_result.is_empty() and not marriage_result.get("marriage", {}).is_empty(),
		"Marriage records persistent spouse, household and family links"
	)
	var family_preserving_person: Dictionary = character._life_record()
	family_preserving_person["date_of_birth"] = (LifeSimulationServiceScript.date_of_birth_for_age(
		date, 25, "marriage-family-test"
	))
	family_preserving_person["age"] = 25
	family_preserving_person["life_stage_id"] = "young-adult"
	var family_preserving_spouse := _life_test_person("family-preserving-spouse", 25, date)
	var family_preserving_marriage := LifeSimulationServiceScript.record_marriage(
		family_preserving_person, family_preserving_spouse, date, character.household
	)
	var preserved_tree: Dictionary = family_preserving_marriage.get("household", {}).get(
		"family_tree", {}
	)
	var preserved_parent_edge := false
	for edge in preserved_tree.get("relationships", []):
		if str(edge.get("type", "")) in ["parent_of", "guardian_of"]:
			preserved_parent_edge = true
	_check(
		(
			(
				preserved_tree.get("member_ids", []).size()
				>= character.family_tree.get("member_ids", []).size() + 1
			)
			and preserved_parent_edge
		),
		"Marriage retains the existing family tree and parent or guardian links"
	)
	var shared_household: Dictionary = marriage_result.get("household", {})
	var unmarried_birth := LifeSimulationServiceScript.record_childbirth(
		_life_test_person("unwed-parent-one", 25, date),
		_life_test_person("unwed-parent-two", 25, date),
		{"id": "unwed-household", "family_id": "unwed-family"},
		"",
		date
	)
	_check(
		str(unmarried_birth.get("error", "")) == "marriage_not_active",
		"Local childbirth requires an active recorded marriage"
	)
	var birth_result := LifeSimulationServiceScript.record_childbirth(
		adult_one, adult_two, shared_household, "Amina", date, "birth-retry-key"
	)
	_check(bool(birth_result.get("ok", false)), "Childbirth creates a persistent NPC character")
	var child: Dictionary = birth_result.get("child", {})
	_check(
		child.get("date_of_birth", {}) == date and child.get("age", -1) == 0,
		"Child NPC has the exact world-date DOB and no player control"
	)
	var replayed_birth := LifeSimulationServiceScript.record_childbirth(
		adult_one, adult_two, birth_result.get("household", {}), "Amina", date, "birth-retry-key"
	)
	_check(
		(
			bool(replayed_birth.get("replayed", false))
			and replayed_birth.get("child", {}).get("person_id", "") == child.get("person_id", "")
		),
		"Childbirth retries do not duplicate a child"
	)
	_check(
		adult_one.life_history.any(
			func(event: Dictionary) -> bool: return str(event.get("type", "")) == "marriage"
		),
		"Marriage is retained in life history"
	)

	var retiree := _life_test_person("retiree-1", 60, date)
	var retirement := LifeSimulationServiceScript.record_retirement(retiree, date)
	var repeat_retirement := LifeSimulationServiceScript.record_retirement(retiree, date)
	_check(
		bool(retirement.get("ok", false)) and bool(repeat_retirement.get("already_retired", false)),
		"Retirement status is age-gated and idempotent"
	)
	_check(
		LifeSimulationServiceScript.can_take_active_action(retiree),
		"Retired characters remain alive and active"
	)
	var death := character.record_death(future_date, "illness")
	_check(
		bool(death.get("ok", false)) and character.life_status == "deceased",
		"Central death handling preserves a deceased character record"
	)
	_check(
		not character.can_take_active_action(),
		"Deceased characters cannot take normal active actions"
	)
	var deceased_balance := character.money
	var deceased_location := character.current_location
	var deceased_energy := character.energy
	var deceased_hunger := character.hunger
	character.set_location("town", Vector2(10.0, 10.0))
	_check(
		character.current_location == deceased_location,
		"Deceased characters cannot change location"
	)
	_check(
		not character.try_spend(1) and character.money == deceased_balance,
		"Deceased characters cannot spend money"
	)
	character.advance_time(30)
	character.sleep_until_morning()
	character.spend_energy(10.0)
	_check(
		character.energy == deceased_energy and character.hunger == deceased_hunger,
		"Deceased characters cannot advance needs or sleep"
	)
	_check(not character.consume_item("meat_pie"), "Deceased characters cannot consume inventory")
	_check(
		(
			not character.inheritance_events.is_empty()
			and character.inheritance_events[0].get("transfer_performed", true) == false
		),
		"Death records an inheritance hook without transferring assets"
	)
	_check(
		character.life_history.any(
			func(event: Dictionary) -> bool: return str(event.get("type", "")) == "death"
		),
		"Death is recorded in history"
	)


func _life_test_person(person_id: String, age: int, world_date: Dictionary) -> Dictionary:
	var dob: Dictionary = LifeSimulationServiceScript.date_of_birth_for_age(
		world_date, age, person_id
	)
	return {
		"character_id": person_id,
		"person_id": person_id,
		"name": person_id.capitalize(),
		"age": age,
		"date_of_birth": dob,
		"life_stage_id":
		str(LifeSimulationServiceScript.life_stage_for_age(age).get("id", "unknown")),
		"life_status": "alive",
		"household_id": "",
		"family_ids": [],
		"life_history": [],
		"relationships": [],
		"marriages": [],
		"inheritance_event_ids": [],
		"inheritance_events": [],
		"last_life_processed_date": world_date.duplicate(true),
		"is_player_controlled": false,
	}


func _test_save_and_load() -> void:
	var character := CharacterStateScript.new()
	character.create_new(
		"Nneka", 16, "girl", {"hairstyle": "Braids"}, HouseholdFactoryScript.create_household()
	)
	character.money = 4321
	character.hunger = 61.0
	character.current_location = "classroom"
	character.position = Vector2(321.0, 456.0)
	character.academic_scores["Biology"] = 88
	character.add_item("water", "Bottled water", 2, "food", 8)
	var clock := WorldClockScript.new()
	clock.advance_minutes(75)
	var save_result: Dictionary = SaveServiceScript.save_state(character, clock, TEST_SAVE_PATH)
	_check(bool(save_result.get("ok", false)), "A local save can be written")
	var loaded: Dictionary = SaveServiceScript.load_state(TEST_SAVE_PATH)
	_check(bool(loaded.get("ok", false)), "The saved life can be loaded")
	if bool(loaded.get("ok", false)):
		var restored := CharacterStateScript.new()
		restored.load_dictionary(loaded["character"])
		var restored_clock := WorldClockScript.new()
		restored_clock.load_dictionary(loaded["clock"])
		_check(
			restored.name == character.name and restored.age == 16,
			"Save/load restores character identity and student age"
		)
		_check(
			restored.money == 4321 and is_equal_approx(restored.hunger, 61.0),
			"Save/load restores money and needs"
		)
		_check(restored.current_location == "classroom", "Save/load restores current location")
		_check(
			restored.position.is_equal_approx(Vector2(321.0, 456.0)),
			"Save/load restores the character position"
		)
		_check(
			restored.appearance.get("hairstyle", "") == "Braids",
			"Save/load restores appearance choices"
		)
		_check(restored.academic_scores["Biology"] == 88, "Save/load restores academic data")
		_check(
			restored_clock.day == clock.day and restored_clock.minute_of_day == clock.minute_of_day,
			"Save/load restores world time"
		)
		_check(
			restored.inventory.size() == character.inventory.size(),
			"Save/load restores the inventory"
		)
		_check(
			(
				restored.date_of_birth == character.date_of_birth
				and restored.life_stage_id == character.life_stage_id
			),
			"Save/load restores the authoritative DOB and life stage"
		)
		_check(
			(
				restored.life_history.size() == character.life_history.size()
				and (
					restored.family_tree.get("member_ids", []).size()
					== character.family_tree.get("member_ids", []).size()
				)
			),
			"Save/load restores recorded life history and family-tree links"
		)
		_check(
			(
				restored.household.get("family_members", []).size()
				== character.household.get("family_members", []).size()
			),
			"Save/load restores persistent NPC family people"
		)
	var absolute_path := ProjectSettings.globalize_path(TEST_SAVE_PATH)
	if FileAccess.file_exists(TEST_SAVE_PATH):
		DirAccess.remove_absolute(absolute_path)


func _check(condition: bool, description: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(description)
