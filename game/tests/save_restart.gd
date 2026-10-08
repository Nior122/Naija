extends SceneTree

const CharacterStateScript = preload("res://scripts/domain/character_state.gd")
const WorldClockScript = preload("res://scripts/domain/world_clock.gd")
const HouseholdFactoryScript = preload("res://scripts/domain/household_factory.gd")
const SaveServiceScript = preload("res://scripts/services/save_service.gd")
const RESTART_SAVE_PATH: String = "user://naija-stage1-restart-test.json"


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var args := OS.get_cmdline_user_args()
	if args.is_empty():
		push_error("Pass 'write' or 'read' after -- to run the two-process save/restart check.")
		quit(2)
		return
	if args[0] == "write":
		_write_checkpoint()
	elif args[0] == "read":
		_read_checkpoint()
	else:
		push_error("Unknown restart test phase: %s" % args[0])
		quit(2)


func _write_checkpoint() -> void:
	var character := CharacterStateScript.new()
	character.create_new(
		"Restart Student",
		16,
		"girl",
		{"hairstyle": "Braids"},
		HouseholdFactoryScript.create_household()
	)
	character.money = 4321
	character.hunger = 61.0
	character.energy = 54.0
	character.current_location = "classroom"
	character.position = Vector2(321.0, 456.0)
	character.academic_scores["Biology"] = 88
	character.attendance.append(
		{"day": 3, "subject": "Biology", "score": 88, "attended_at": "Day 3 · 11:30"}
	)
	character.add_item("water", "Bottled water", 2, "food", 8)
	var clock := WorldClockScript.new()
	clock.day = 3
	clock.minute_of_day = 690
	var result: Dictionary = SaveServiceScript.save_state(character, clock, RESTART_SAVE_PATH)
	if not bool(result.get("ok", false)):
		push_error(
			"Could not write restart checkpoint: %s" % str(result.get("error", "unknown error"))
		)
		quit(1)
		return
	print("Wrote a checkpoint. Close this Godot process and run the read phase in a new process.")
	quit(0)


func _read_checkpoint() -> void:
	var result: Dictionary = SaveServiceScript.load_state(RESTART_SAVE_PATH)
	if not bool(result.get("ok", false)):
		push_error(
			"Could not load restart checkpoint: %s" % str(result.get("error", "unknown error"))
		)
		quit(1)
		return
	var character := CharacterStateScript.new()
	character.load_dictionary(result["character"])
	var clock := WorldClockScript.new()
	clock.load_dictionary(result["clock"])
	var passed := true
	passed = (
		_expect(character.name == "Restart Student" and character.age == 16, "character identity")
		and passed
	)
	passed = (
		_expect(character.appearance.get("hairstyle", "") == "Braids", "character appearance")
		and passed
	)
	passed = (
		_expect(
			character.home_id != "" and character.household.get("guardians", []).size() == 2,
			"household and home"
		)
		and passed
	)
	passed = (
		_expect(
			character.money == 4321 and is_equal_approx(character.hunger, 61.0), "money and needs"
		)
		and passed
	)
	passed = (
		_expect(character.position.is_equal_approx(Vector2(321.0, 456.0)), "saved position")
		and passed
	)
	passed = _expect(character.current_location == "classroom", "current location") and passed
	passed = (
		_expect(character.academic_scores.get("Biology", 0) == 88, "academic result") and passed
	)
	passed = (
		_expect(
			character.attendance.size() == 1 and character.inventory.size() >= 5,
			"attendance and inventory"
		)
		and passed
	)
	var water_quantity := 0
	for item in character.inventory:
		if str(item.get("id", "")) == "water":
			water_quantity = int(item.get("quantity", 0))
	passed = _expect(water_quantity == 2, "saved inventory item quantity") and passed
	passed = _expect(clock.day == 3 and clock.minute_of_day == 690, "world clock") and passed
	DirAccess.remove_absolute(ProjectSettings.globalize_path(RESTART_SAVE_PATH))
	if passed:
		print("PASS: saved character state survived a fresh Godot process.")
		quit(0)
	else:
		quit(1)


func _expect(condition: bool, description: String) -> bool:
	if not condition:
		push_error("Restart save check failed: %s" % description)
	return condition
