extends SceneTree

const CharacterStateScript = preload("res://scripts/domain/character_state.gd")
const WorldClockScript = preload("res://scripts/domain/world_clock.gd")
const HouseholdFactoryScript = preload("res://scripts/domain/household_factory.gd")
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
	_test_save_and_load()
	if _failures.is_empty():
		print("PASS: %d Stage 1 domain checks" % _checks)
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
	var absolute_path := ProjectSettings.globalize_path(TEST_SAVE_PATH)
	if FileAccess.file_exists(TEST_SAVE_PATH):
		DirAccess.remove_absolute(absolute_path)


func _check(condition: bool, description: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(description)
